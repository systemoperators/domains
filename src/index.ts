export { DomainVerifier } from './verifier.js';

export type {
  DomainStore,
  DomainRecord,
  DomainStatusUpdate,
  VerificationConfig,
  CloudflareConfig,
  AddDomainOptions,
  CustomHostname,
  DNSRecord,
  DNSVerificationResult,
  DomainStatusSummary,
  DNSProvider,
  WorkflowStep,
} from './types.js';

export {
  lookupDNS,
  verifyCNAME,
  verifyDNS,
  checkSSL,
  normalizeDomain,
} from './dns.js';

export {
  createCustomHostname,
  getCustomHostname,
  deleteCustomHostname,
  listCustomHostnames,
  getSSLStatus,
} from './cloudflare.js';

export {
  isValidDomain,
  generateDNSRecords,
  isDomainReady,
  getDomainStatusSummary,
  shouldRedirect,
  extractSubdomain,
} from './domain-helpers.js';
