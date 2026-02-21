# @systemoperator/domains

Custom domain verification for Cloudflare SaaS apps. Handles DNS verification, SSL certificate provisioning, and ongoing monitoring via [Cloudflare Custom Hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/custom-hostnames/).

Zero runtime dependencies. Works in Cloudflare Workers, Node.js, Deno, and Bun.

## Install

```bash
npm install @systemoperator/domains
```

## Quick start

```typescript
import { DomainVerifier } from '@systemoperator/domains';

const verifier = new DomainVerifier({
  cfApiToken: env.CF_API_TOKEN,
  cfZoneId: env.CF_ZONE_ID,
  store: myDomainStore, // you implement this
  verification: {
    onSSLActive: async (hostname) => {
      await sendEmail(user, `${hostname} is live!`);
    },
    onFailed: async (hostname, reason) => {
      await logError(hostname, reason);
    },
    onStatusLost: async (hostname) => {
      await alertUser(hostname, 'DNS records may have been removed');
    },
  },
});

// add a domain
await verifier.addDomain('blog.example.com', { wwwEnabled: true });

// run verification (in a Cloudflare Workflow)
await verifier.verify('blog.example.com', step);

// run verification (standalone, no workflow)
await verifier.verify('blog.example.com');

// recheck active domains (from a cron job)
const { checked, lost } = await verifier.recheckAll();
```

## DomainStore interface

You bring your own persistence. Implement this interface with your database of choice (Drizzle, Prisma, D1, raw SQL, etc):

```typescript
import type { DomainStore, DomainRecord, DomainStatusUpdate } from '@systemoperator/domains';

const store: DomainStore = {
  async save(domain: DomainRecord) { /* INSERT into your DB */ },
  async get(hostname: string) { /* SELECT by hostname */ },
  async updateStatus(hostname: string, update: DomainStatusUpdate) { /* UPDATE fields */ },
  async listActive() { /* SELECT WHERE sslStatus = 'active' */ },
};
```

## Cloudflare Workflow integration

The `verify()` method accepts an optional Cloudflare `WorkflowStep` for durable execution with automatic retries and sleep:

```typescript
import { DomainVerifier } from '@systemoperator/domains';

export class DomainWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const verifier = new DomainVerifier({ /* ... */ });
    await verifier.verify(event.payload.hostname, step);
  }
}
```

Without a step, `verify()` uses `setTimeout` for waits, suitable for cron jobs or manual checks.

## Standalone utilities

All helpers are exported individually for use without the DomainVerifier class:

```typescript
import {
  // DNS
  lookupDNS, verifyCNAME, verifyDNS, checkSSL, normalizeDomain,
  // Cloudflare API
  createCustomHostname, getCustomHostname, deleteCustomHostname, listCustomHostnames, getSSLStatus,
  // Domain helpers
  isValidDomain, generateDNSRecords, isDomainReady, getDomainStatusSummary, shouldRedirect, extractSubdomain,
} from '@systemoperator/domains';
```

## Configuration

```typescript
const verifier = new DomainVerifier({
  cfApiToken: '...',
  cfZoneId: '...',
  store: myStore,
  verification: {
    // retry settings
    dnsRetries: 10,           // default: 10
    dnsRetryInterval: 300000, // default: 5 min
    sslRetries: 20,           // default: 20
    sslRetryInterval: 600000, // default: 10 min
    initialDelay: 300000,     // default: 5 min (DNS propagation wait)

    // lifecycle hooks
    onDNSVerified: async (hostname) => { },
    onSSLActive: async (hostname) => { },
    onFailed: async (hostname, reason) => { },
    onStatusLost: async (hostname) => { }, // was active, now broken
    onRetry: async (hostname, step, attempt) => { },
  },
});
```

## License

MIT - System Operator LLC
