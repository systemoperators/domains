/**
 * Types for @systemoperator/domains
 */

/** User implements this to provide persistence */
export interface DomainStore {
  save(domain: DomainRecord): Promise<void>;
  get(hostname: string): Promise<DomainRecord | null>;
  updateStatus(hostname: string, update: DomainStatusUpdate): Promise<void>;
  listActive(): Promise<DomainRecord[]>;
  listPending(): Promise<DomainRecord[]>;
}

/** Domain record managed by the package */
export interface DomainRecord {
  hostname: string;
  targetDomain: string;
  wwwEnabled: boolean;
  redirectMode: 'www-to-apex' | 'apex-to-www' | 'none';
  cfHostnameId: string | null;
  cfWwwHostnameId: string | null;
  dnsStatus: 'pending' | 'verified' | 'failed';
  dnsWwwStatus: 'pending' | 'verified' | 'failed';
  sslStatus: 'pending' | 'active' | 'failed';
  sslWwwStatus: 'pending' | 'active' | 'failed';
  error: string | null;
  verifiedAt: number | null;
}

/** Partial update for domain status fields */
export interface DomainStatusUpdate {
  dnsStatus?: DomainRecord['dnsStatus'];
  dnsWwwStatus?: DomainRecord['dnsWwwStatus'];
  sslStatus?: DomainRecord['sslStatus'];
  sslWwwStatus?: DomainRecord['sslWwwStatus'];
  cfHostnameId?: string | null;
  cfWwwHostnameId?: string | null;
  error?: string | null;
  verifiedAt?: number | null;
}

/** Cloudflare API credentials */
export interface CloudflareConfig {
  apiToken: string;
  zoneId: string;
}

/** Verification workflow configuration */
export interface VerificationConfig {
  dnsRetries?: number;
  dnsRetryInterval?: number;
  sslRetries?: number;
  sslRetryInterval?: number;
  initialDelay?: number;

  onDNSVerified?: (hostname: string) => Promise<void>;
  onSSLActive?: (hostname: string) => Promise<void>;
  onFailed?: (hostname: string, reason: string) => Promise<void>;
  onStatusLost?: (hostname: string) => Promise<void>;
  onRetry?: (hostname: string, step: string, attempt: number) => Promise<void>;
}

/** Options for adding a domain */
export interface AddDomainOptions {
  wwwEnabled?: boolean;
  redirectMode?: DomainRecord['redirectMode'];
}

/** Cloudflare Custom Hostname shape from the API */
export interface CustomHostname {
  id: string;
  hostname: string;
  ssl: {
    status: string;
    method: string;
    type: string;
    validation_errors?: Array<{ message: string }>;
  };
  status: string;
  verification_errors?: string[];
  ownership_verification?: {
    type: string;
    name: string;
    value: string;
  };
  ownership_verification_http?: {
    http_url: string;
    http_body: string;
  };
}

/** DNS record type */
export interface DNSRecord {
  type: string;
  name: string;
  content: string;
  ttl?: number;
}

/** DNS verification result */
export interface DNSVerificationResult {
  verified: boolean;
  records: Array<{
    type: string;
    name: string;
    expected: string;
    actual: string | null;
    correct: boolean;
  }>;
}

/** Domain status summary */
export interface DomainStatusSummary {
  overall: 'pending' | 'active' | 'failed';
  message: string;
  details: {
    dns: { apex: string; www?: string };
    ssl: { apex: string; www?: string };
  };
}

/** DNS-over-HTTPS provider */
export type DNSProvider = 'google' | 'cloudflare';

/** Cloudflare Workflow step interface - matches CF Workflows API */
export interface WorkflowStep {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: number | string): Promise<void>;
}
