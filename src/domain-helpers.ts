/**
 * Domain validation, status, and redirect helpers
 */

import type { DomainRecord, DomainStatusSummary, DNSRecord } from './types.js';
import { normalizeDomain } from './dns.js';

/**
 * Validate domain format
 */
export function isValidDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/i.test(
    normalized
  );
}

/**
 * Generate required DNS records for a custom domain
 */
export function generateDNSRecords(
  hostname: string,
  targetDomain: string,
  wwwEnabled: boolean = false
): DNSRecord[] {
  const records: DNSRecord[] = [
    {
      type: 'CNAME',
      name: '@',
      content: targetDomain,
      ttl: 3600,
    },
  ];

  if (wwwEnabled) {
    records.push({
      type: 'CNAME',
      name: 'www',
      content: targetDomain,
      ttl: 3600,
    });
  }

  return records;
}

/**
 * Check if domain is fully active (DNS verified + SSL active)
 */
export function isDomainReady(record: DomainRecord): boolean {
  if (record.sslStatus !== 'active') {
    return false;
  }

  if (record.wwwEnabled && record.sslWwwStatus !== 'active') {
    return false;
  }

  return true;
}

/**
 * Get domain status summary for display
 */
export function getDomainStatusSummary(record: DomainRecord): DomainStatusSummary {
  const details: DomainStatusSummary['details'] = {
    dns: {
      apex: record.dnsStatus,
      ...(record.wwwEnabled ? { www: record.dnsWwwStatus } : {}),
    },
    ssl: {
      apex: record.sslStatus,
      ...(record.wwwEnabled ? { www: record.sslWwwStatus } : {}),
    },
  };

  if (record.dnsStatus === 'failed' || record.sslStatus === 'failed') {
    return {
      overall: 'failed',
      message: record.error || 'Configuration failed',
      details,
    };
  }

  if (isDomainReady(record)) {
    return {
      overall: 'active',
      message: 'Domain is active',
      details,
    };
  }

  const pendingSteps = [];
  if (record.dnsStatus !== 'verified') {
    pendingSteps.push('DNS verification');
  }
  if (record.sslStatus !== 'active') {
    pendingSteps.push('SSL certificate');
  }

  return {
    overall: 'pending',
    message: `Waiting for ${pendingSteps.join(' and ')}`,
    details,
  };
}

/**
 * Determine if www redirect is needed based on mode and request hostname
 */
export function shouldRedirect(
  record: DomainRecord,
  requestHostname: string
): { redirect: boolean; targetHostname?: string } {
  const isWww = requestHostname.startsWith('www.');
  const mode = record.redirectMode;

  if (mode === 'none') {
    return { redirect: false };
  }

  // redirect to www (canonical is www)
  if (mode === 'apex-to-www' && !isWww) {
    return {
      redirect: true,
      targetHostname: `www.${record.hostname}`,
    };
  }

  // redirect to apex (canonical is apex)
  if (mode === 'www-to-apex' && isWww) {
    return {
      redirect: true,
      targetHostname: record.hostname,
    };
  }

  return { redirect: false };
}

/**
 * Extract subdomain from hostname (e.g., "blog.example.com" -> "blog")
 */
export function extractSubdomain(hostname: string): string | null {
  const parts = hostname.split('.');
  if (parts.length <= 2) {
    return null;
  }
  return parts[0];
}
