# Changelog

## 0.1.0

- initial release, extracted from system operator internal tooling
- DomainVerifier class: addDomain, removeDomain, verify, recheck, recheckAll
- DNS-over-HTTPS utilities: lookupDNS, verifyCNAME, verifyDNS, checkSSL
- Cloudflare Custom Hostnames API: create, get, delete, list, getSSLStatus
- domain helpers: isValidDomain, generateDNSRecords, isDomainReady, shouldRedirect
- DomainStore interface for bring-your-own persistence
- WorkflowStep support for Cloudflare Workflows durable execution
- lifecycle hooks: onDNSVerified, onSSLActive, onFailed, onStatusLost, onRetry
