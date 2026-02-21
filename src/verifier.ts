/**
 * DomainVerifier - main entry point for custom domain management
 * Wraps Cloudflare Custom Hostnames API + DNS verification + store
 */

import type {
  CloudflareConfig,
  DomainStore,
  DomainRecord,
  DomainStatusSummary,
  VerificationConfig,
  AddDomainOptions,
  WorkflowStep,
} from './types.js';
import { createCustomHostname, deleteCustomHostname, getCustomHostname } from './cloudflare.js';
import { verifyCNAME, checkSSL as checkSSLDirect } from './dns.js';
import { isDomainReady, getDomainStatusSummary } from './domain-helpers.js';

const DEFAULTS = {
  dnsRetries: 10,
  dnsRetryInterval: 300_000,    // 5 min
  sslRetries: 20,
  sslRetryInterval: 600_000,    // 10 min
  initialDelay: 300_000,        // 5 min
};

export class DomainVerifier {
  private cf: CloudflareConfig;
  private store: DomainStore;
  private config: Required<Pick<VerificationConfig, 'dnsRetries' | 'dnsRetryInterval' | 'sslRetries' | 'sslRetryInterval' | 'initialDelay'>> & VerificationConfig;

  constructor(options: {
    cfApiToken: string;
    cfZoneId: string;
    store: DomainStore;
    verification?: VerificationConfig;
  }) {
    this.cf = { apiToken: options.cfApiToken, zoneId: options.cfZoneId };
    this.store = options.store;
    this.config = {
      dnsRetries: options.verification?.dnsRetries ?? DEFAULTS.dnsRetries,
      dnsRetryInterval: options.verification?.dnsRetryInterval ?? DEFAULTS.dnsRetryInterval,
      sslRetries: options.verification?.sslRetries ?? DEFAULTS.sslRetries,
      sslRetryInterval: options.verification?.sslRetryInterval ?? DEFAULTS.sslRetryInterval,
      initialDelay: options.verification?.initialDelay ?? DEFAULTS.initialDelay,
      ...options.verification,
    };
  }

  /**
   * Add a custom domain: create CF hostnames and save to store
   */
  async addDomain(hostname: string, options: AddDomainOptions = {}): Promise<DomainRecord> {
    const wwwEnabled = options.wwwEnabled ?? false;
    const redirectMode = options.redirectMode ?? 'none';

    // create apex hostname on Cloudflare
    const apexResult = await createCustomHostname(this.cf, hostname);
    if (!apexResult.success || !apexResult.hostname) {
      throw new Error(`Failed to create hostname for ${hostname}: ${apexResult.error}`);
    }

    // create www hostname if enabled
    let cfWwwHostnameId: string | null = null;
    if (wwwEnabled) {
      const wwwResult = await createCustomHostname(this.cf, `www.${hostname}`);
      if (!wwwResult.success || !wwwResult.hostname) {
        // clean up apex hostname
        await deleteCustomHostname(this.cf, apexResult.hostname.id);
        throw new Error(`Failed to create www hostname for ${hostname}: ${wwwResult.error}`);
      }
      cfWwwHostnameId = wwwResult.hostname.id;
    }

    const record: DomainRecord = {
      hostname,
      targetDomain: '',  // set by the product when calling addDomain
      wwwEnabled,
      redirectMode,
      cfHostnameId: apexResult.hostname.id,
      cfWwwHostnameId,
      dnsStatus: 'pending',
      dnsWwwStatus: wwwEnabled ? 'pending' : 'pending',
      sslStatus: 'pending',
      sslWwwStatus: wwwEnabled ? 'pending' : 'pending',
      error: null,
      verifiedAt: null,
    };

    await this.store.save(record);
    return record;
  }

  /**
   * Remove a custom domain: delete CF hostnames and update store
   */
  async removeDomain(hostname: string): Promise<void> {
    const record = await this.store.get(hostname);
    if (!record) return;

    if (record.cfHostnameId) {
      await deleteCustomHostname(this.cf, record.cfHostnameId);
    }
    if (record.cfWwwHostnameId) {
      await deleteCustomHostname(this.cf, record.cfWwwHostnameId);
    }

    await this.store.updateStatus(hostname, {
      cfHostnameId: null,
      cfWwwHostnameId: null,
      dnsStatus: 'failed',
      sslStatus: 'failed',
      error: 'Domain removed',
    });
  }

  /**
   * Run full verification workflow for a domain.
   * If a Cloudflare WorkflowStep is provided, uses step.sleep() and step.do() for durable execution.
   * Without a step, uses setTimeout-based waits (for cron/manual use).
   */
  async verify(hostname: string, step?: WorkflowStep): Promise<void> {
    const record = await this.store.get(hostname);
    if (!record) {
      throw new Error(`Domain ${hostname} not found in store`);
    }
    if (!record.cfHostnameId) {
      throw new Error(`Domain ${hostname} has no Cloudflare hostname ID`);
    }

    // initial delay for DNS propagation
    if (step) {
      await step.sleep('initial-dns-wait', this.config.initialDelay);
    } else {
      await this.delay(this.config.initialDelay);
    }

    // DNS verification phase
    const dnsOk = await this.verifyDNSPhase(record, step);
    if (!dnsOk) return;

    // short pause before SSL check
    if (step) {
      await step.sleep('ssl-wait', 120_000);
    } else {
      await this.delay(120_000);
    }

    // SSL verification phase
    await this.verifySSLPhase(record, step);
  }

  /**
   * One-off DNS check for a hostname
   */
  async checkDNS(hostname: string): Promise<{ apex: boolean; www: boolean }> {
    const record = await this.store.get(hostname);
    if (!record) {
      throw new Error(`Domain ${hostname} not found in store`);
    }

    const apex = await verifyCNAME(hostname, record.targetDomain, 'cloudflare');
    const www = record.wwwEnabled
      ? await verifyCNAME(`www.${hostname}`, record.targetDomain, 'cloudflare')
      : true;

    return { apex, www };
  }

  /**
   * One-off SSL check for a hostname
   */
  async checkSSL(hostname: string): Promise<{ apex: boolean; www: boolean }> {
    const record = await this.store.get(hostname);

    const apex = await checkSSLDirect(hostname);
    const www = record?.wwwEnabled
      ? await checkSSLDirect(`www.${hostname}`)
      : true;

    return { apex, www };
  }

  /**
   * Get status summary from a domain record
   */
  getStatus(record: DomainRecord): DomainStatusSummary {
    return getDomainStatusSummary(record);
  }

  /**
   * Recheck a single active domain. If DNS or SSL is gone, marks it failed
   * and calls onStatusLost hook.
   */
  async recheck(hostname: string): Promise<DomainStatusSummary> {
    const record = await this.store.get(hostname);
    if (!record) {
      throw new Error(`Domain ${hostname} not found in store`);
    }

    // check DNS
    const apexDns = await verifyCNAME(hostname, record.targetDomain, 'cloudflare');
    const wwwDns = record.wwwEnabled
      ? await verifyCNAME(`www.${hostname}`, record.targetDomain, 'cloudflare')
      : true;

    // check SSL via CF API if we have hostname IDs
    let apexSsl = false;
    let wwwSsl = false;

    if (record.cfHostnameId) {
      const apexResult = await getCustomHostname(this.cf, record.cfHostnameId);
      apexSsl = apexResult.success && apexResult.hostname?.ssl.status === 'active';
    }

    if (record.wwwEnabled && record.cfWwwHostnameId) {
      const wwwResult = await getCustomHostname(this.cf, record.cfWwwHostnameId);
      wwwSsl = wwwResult.success && wwwResult.hostname?.ssl.status === 'active';
    } else if (!record.wwwEnabled) {
      wwwSsl = true;
    }

    const wasActive = isDomainReady(record);

    // update statuses
    const update: Parameters<DomainStore['updateStatus']>[1] = {
      dnsStatus: apexDns ? 'verified' : 'failed',
      sslStatus: apexSsl ? 'active' : 'failed',
    };

    if (record.wwwEnabled) {
      update.dnsWwwStatus = wwwDns ? 'verified' : 'failed';
      update.sslWwwStatus = wwwSsl ? 'active' : 'failed';
    }

    const nowBroken = !apexDns || !apexSsl || (record.wwwEnabled && (!wwwDns || !wwwSsl));

    if (nowBroken) {
      const reasons = [];
      if (!apexDns) reasons.push('apex DNS missing');
      if (!apexSsl) reasons.push('apex SSL inactive');
      if (record.wwwEnabled && !wwwDns) reasons.push('www DNS missing');
      if (record.wwwEnabled && !wwwSsl) reasons.push('www SSL inactive');
      update.error = reasons.join(', ');
    } else {
      update.error = null;
    }

    await this.store.updateStatus(hostname, update);

    // fire hook if domain was active but is now broken
    if (wasActive && nowBroken && this.config.onStatusLost) {
      await this.config.onStatusLost(hostname);
    }

    // return fresh status
    const updated = await this.store.get(hostname);
    return getDomainStatusSummary(updated!);
  }

  /**
   * Recheck all active domains. Call this from a cron job.
   */
  async recheckAll(): Promise<{ checked: number; lost: string[] }> {
    const active = await this.store.listActive();
    const lost: string[] = [];

    for (const record of active) {
      const status = await this.recheck(record.hostname);
      if (status.overall === 'failed') {
        lost.push(record.hostname);
      }
    }

    return { checked: active.length, lost };
  }

  // -- private --

  private async verifyDNSPhase(record: DomainRecord, step?: WorkflowStep): Promise<boolean> {
    for (let attempt = 1; attempt <= this.config.dnsRetries; attempt++) {
      const doCheck = async () => {
        const apexOk = await verifyCNAME(record.hostname, record.targetDomain, 'cloudflare');
        const wwwOk = record.wwwEnabled
          ? await verifyCNAME(`www.${record.hostname}`, record.targetDomain, 'cloudflare')
          : true;

        if (apexOk && wwwOk) {
          await this.store.updateStatus(record.hostname, {
            dnsStatus: 'verified',
            dnsWwwStatus: record.wwwEnabled ? 'verified' : record.dnsWwwStatus,
          });
          if (this.config.onDNSVerified) {
            await this.config.onDNSVerified(record.hostname);
          }
          return true;
        }

        return false;
      };

      let verified: boolean;
      if (step) {
        verified = await step.do(`verify-dns-attempt-${attempt}`, doCheck);
      } else {
        verified = await doCheck();
      }

      if (verified) return true;

      if (this.config.onRetry) {
        await this.config.onRetry(record.hostname, 'dns', attempt);
      }

      if (attempt < this.config.dnsRetries) {
        if (step) {
          await step.sleep(`dns-retry-wait-${attempt}`, this.config.dnsRetryInterval);
        } else {
          await this.delay(this.config.dnsRetryInterval);
        }
      }
    }

    // DNS failed after all retries
    await this.store.updateStatus(record.hostname, {
      dnsStatus: 'failed',
      error: 'DNS verification failed after all retries',
    });
    if (this.config.onFailed) {
      await this.config.onFailed(record.hostname, 'DNS verification failed after all retries');
    }
    return false;
  }

  private async verifySSLPhase(record: DomainRecord, step?: WorkflowStep): Promise<boolean> {
    for (let attempt = 1; attempt <= this.config.sslRetries; attempt++) {
      const doCheck = async () => {
        if (!record.cfHostnameId) return false;

        const apexResult = await getCustomHostname(this.cf, record.cfHostnameId);
        if (!apexResult.success || !apexResult.hostname) {
          throw new Error('Failed to get hostname status from Cloudflare');
        }

        const apexSslStatus = apexResult.hostname.ssl.status;
        let wwwSslStatus: string | null = null;

        if (record.wwwEnabled && record.cfWwwHostnameId) {
          const wwwResult = await getCustomHostname(this.cf, record.cfWwwHostnameId);
          if (wwwResult.success && wwwResult.hostname) {
            wwwSslStatus = wwwResult.hostname.ssl.status;
          }
        }

        const apexActive = apexSslStatus === 'active';
        const wwwActive = record.wwwEnabled ? wwwSslStatus === 'active' : true;

        // update intermediate status
        await this.store.updateStatus(record.hostname, {
          sslStatus: apexActive ? 'active' : 'pending',
          sslWwwStatus: record.wwwEnabled
            ? (wwwActive ? 'active' : 'pending')
            : record.sslWwwStatus,
        });

        if (apexActive && wwwActive) {
          await this.store.updateStatus(record.hostname, {
            sslStatus: 'active',
            sslWwwStatus: record.wwwEnabled ? 'active' : record.sslWwwStatus,
            verifiedAt: Date.now(),
            error: null,
          });
          if (this.config.onSSLActive) {
            await this.config.onSSLActive(record.hostname);
          }
          return true;
        }

        return false;
      };

      let verified: boolean;
      if (step) {
        verified = await step.do(`verify-ssl-attempt-${attempt}`, doCheck);
      } else {
        verified = await doCheck();
      }

      if (verified) return true;

      if (this.config.onRetry) {
        await this.config.onRetry(record.hostname, 'ssl', attempt);
      }

      if (attempt < this.config.sslRetries) {
        if (step) {
          await step.sleep(`ssl-retry-wait-${attempt}`, this.config.sslRetryInterval);
        } else {
          await this.delay(this.config.sslRetryInterval);
        }
      }
    }

    // SSL failed after all retries
    await this.store.updateStatus(record.hostname, {
      sslStatus: 'failed',
      error: 'SSL activation failed after all retries',
    });
    if (this.config.onFailed) {
      await this.config.onFailed(record.hostname, 'SSL activation failed after all retries');
    }
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
