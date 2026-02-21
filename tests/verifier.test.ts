import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { DomainVerifier } from '../src/verifier.js';
import type { DomainStore, DomainRecord, DomainStatusUpdate } from '../src/types.js';

// mock fetch globally
const originalFetch = global.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => any) {
  global.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const body = handler(url, init);
    return {
      ok: true,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
});

function makeStore(initial: DomainRecord[] = []): DomainStore & { records: Map<string, DomainRecord> } {
  const records = new Map<string, DomainRecord>();
  for (const r of initial) {
    records.set(r.hostname, { ...r });
  }

  return {
    records,
    async save(domain: DomainRecord) {
      records.set(domain.hostname, { ...domain });
    },
    async get(hostname: string) {
      const r = records.get(hostname);
      return r ? { ...r } : null;
    },
    async updateStatus(hostname: string, update: DomainStatusUpdate) {
      const r = records.get(hostname);
      if (!r) return;
      Object.assign(r, update);
      records.set(hostname, r);
    },
    async listActive() {
      return Array.from(records.values()).filter(
        (r) => r.sslStatus === 'active'
      );
    },
  };
}

function makeRecord(overrides: Partial<DomainRecord> = {}): DomainRecord {
  return {
    hostname: 'blog.example.com',
    targetDomain: 'custom.myapp.com',
    wwwEnabled: false,
    redirectMode: 'none',
    cfHostnameId: 'cf-apex-123',
    cfWwwHostnameId: null,
    dnsStatus: 'pending',
    dnsWwwStatus: 'pending',
    sslStatus: 'pending',
    sslWwwStatus: 'pending',
    error: null,
    verifiedAt: null,
    ...overrides,
  };
}

describe('DomainVerifier', () => {
  describe('addDomain', () => {
    it('creates CF hostnames and saves to store', async () => {
      mockFetch((url) => {
        if (url.includes('/custom_hostnames') && !url.includes('/cf-')) {
          return {
            success: true,
            result: {
              id: 'cf-new-123',
              hostname: 'test.example.com',
              ssl: { status: 'pending_validation', method: 'http', type: 'dv' },
              status: 'pending',
            },
          };
        }
        return { success: false };
      });

      const store = makeStore();
      const verifier = new DomainVerifier({
        cfApiToken: 'test-token',
        cfZoneId: 'test-zone',
        store,
      });

      const record = await verifier.addDomain('test.example.com');

      expect(record.hostname).toBe('test.example.com');
      expect(record.cfHostnameId).toBe('cf-new-123');
      expect(record.dnsStatus).toBe('pending');
      expect(store.records.has('test.example.com')).toBe(true);
    });

    it('creates www hostname when wwwEnabled', async () => {
      let callCount = 0;
      mockFetch((url, init) => {
        if (url.includes('/custom_hostnames') && init?.method === 'POST') {
          callCount++;
          return {
            success: true,
            result: {
              id: `cf-id-${callCount}`,
              hostname: callCount === 1 ? 'test.example.com' : 'www.test.example.com',
              ssl: { status: 'pending_validation', method: 'http', type: 'dv' },
              status: 'pending',
            },
          };
        }
        return { success: false };
      });

      const store = makeStore();
      const verifier = new DomainVerifier({
        cfApiToken: 'test-token',
        cfZoneId: 'test-zone',
        store,
      });

      const record = await verifier.addDomain('test.example.com', { wwwEnabled: true });

      expect(record.cfHostnameId).toBe('cf-id-1');
      expect(record.cfWwwHostnameId).toBe('cf-id-2');
      expect(record.wwwEnabled).toBe(true);
      expect(callCount).toBe(2);
    });

    it('throws on CF API failure', async () => {
      mockFetch(() => ({
        success: false,
        errors: [{ message: 'Zone not found' }],
      }));

      const store = makeStore();
      const verifier = new DomainVerifier({
        cfApiToken: 'bad-token',
        cfZoneId: 'bad-zone',
        store,
      });

      await expect(verifier.addDomain('test.example.com')).rejects.toThrow('Zone not found');
    });
  });

  describe('removeDomain', () => {
    it('deletes CF hostnames and updates store', async () => {
      const deletedIds: string[] = [];
      mockFetch((url, init) => {
        if (init?.method === 'DELETE') {
          const id = url.split('/').pop()!;
          deletedIds.push(id);
          return { success: true };
        }
        return { success: false };
      });

      const store = makeStore([
        makeRecord({
          cfHostnameId: 'cf-apex',
          cfWwwHostnameId: 'cf-www',
          wwwEnabled: true,
        }),
      ]);

      const verifier = new DomainVerifier({
        cfApiToken: 'test-token',
        cfZoneId: 'test-zone',
        store,
      });

      await verifier.removeDomain('blog.example.com');

      expect(deletedIds).toContain('cf-apex');
      expect(deletedIds).toContain('cf-www');
      const updated = store.records.get('blog.example.com')!;
      expect(updated.cfHostnameId).toBeNull();
      expect(updated.dnsStatus).toBe('failed');
    });

    it('does nothing if domain not found', async () => {
      const store = makeStore();
      const verifier = new DomainVerifier({
        cfApiToken: 'test-token',
        cfZoneId: 'test-zone',
        store,
      });

      await verifier.removeDomain('nonexistent.com');
      // no error
    });
  });

  describe('recheck', () => {
    it('keeps active status when everything is fine', async () => {
      mockFetch((url) => {
        // DNS check
        if (url.includes('dns')) {
          return {
            Status: 0,
            Answer: [{ type: 5, data: 'custom.myapp.com.' }],
          };
        }
        // CF API - get hostname
        if (url.includes('/custom_hostnames/')) {
          return {
            success: true,
            result: {
              id: 'cf-apex-123',
              hostname: 'blog.example.com',
              ssl: { status: 'active', method: 'http', type: 'dv' },
              status: 'active',
            },
          };
        }
        return { success: false };
      });

      const store = makeStore([
        makeRecord({
          dnsStatus: 'verified',
          sslStatus: 'active',
          verifiedAt: Date.now(),
        }),
      ]);

      const verifier = new DomainVerifier({
        cfApiToken: 'test-token',
        cfZoneId: 'test-zone',
        store,
      });

      const status = await verifier.recheck('blog.example.com');
      expect(status.overall).toBe('active');
    });

    it('marks domain failed and calls onStatusLost when DNS removed', async () => {
      mockFetch((url) => {
        // DNS returns empty
        if (url.includes('dns')) {
          return { Status: 0, Answer: [] };
        }
        // CF API still shows active
        if (url.includes('/custom_hostnames/')) {
          return {
            success: true,
            result: {
              id: 'cf-apex-123',
              hostname: 'blog.example.com',
              ssl: { status: 'active', method: 'http', type: 'dv' },
              status: 'active',
            },
          };
        }
        return { success: false };
      });

      let statusLostCalled = false;
      const store = makeStore([
        makeRecord({
          dnsStatus: 'verified',
          sslStatus: 'active',
          verifiedAt: Date.now(),
        }),
      ]);

      const verifier = new DomainVerifier({
        cfApiToken: 'test-token',
        cfZoneId: 'test-zone',
        store,
        verification: {
          onStatusLost: async () => {
            statusLostCalled = true;
          },
        },
      });

      const status = await verifier.recheck('blog.example.com');
      expect(status.overall).toBe('failed');
      expect(statusLostCalled).toBe(true);
    });
  });

  describe('recheckAll', () => {
    it('rechecks all active domains and reports lost ones', async () => {
      mockFetch((url) => {
        // DNS: only good.example.com has valid DNS
        if (url.includes('dns') && url.includes('good.example.com')) {
          return { Status: 0, Answer: [{ type: 5, data: 'custom.myapp.com.' }] };
        }
        if (url.includes('dns')) {
          return { Status: 0, Answer: [] };
        }
        // CF API
        if (url.includes('/custom_hostnames/cf-good')) {
          return {
            success: true,
            result: {
              id: 'cf-good',
              hostname: 'good.example.com',
              ssl: { status: 'active', method: 'http', type: 'dv' },
              status: 'active',
            },
          };
        }
        if (url.includes('/custom_hostnames/cf-bad')) {
          return {
            success: true,
            result: {
              id: 'cf-bad',
              hostname: 'bad.example.com',
              ssl: { status: 'active', method: 'http', type: 'dv' },
              status: 'active',
            },
          };
        }
        return { success: false };
      });

      const store = makeStore([
        makeRecord({
          hostname: 'good.example.com',
          cfHostnameId: 'cf-good',
          dnsStatus: 'verified',
          sslStatus: 'active',
          verifiedAt: Date.now(),
        }),
        makeRecord({
          hostname: 'bad.example.com',
          cfHostnameId: 'cf-bad',
          dnsStatus: 'verified',
          sslStatus: 'active',
          verifiedAt: Date.now(),
        }),
      ]);

      const verifier = new DomainVerifier({
        cfApiToken: 'test-token',
        cfZoneId: 'test-zone',
        store,
      });

      const result = await verifier.recheckAll();
      expect(result.checked).toBe(2);
      expect(result.lost).toContain('bad.example.com');
      expect(result.lost).not.toContain('good.example.com');
    });
  });

  describe('getStatus', () => {
    it('returns status summary from record', () => {
      const verifier = new DomainVerifier({
        cfApiToken: 'x',
        cfZoneId: 'x',
        store: makeStore(),
      });

      const record = makeRecord({ dnsStatus: 'verified', sslStatus: 'active' });
      const status = verifier.getStatus(record);
      expect(status.overall).toBe('active');
    });
  });
});
