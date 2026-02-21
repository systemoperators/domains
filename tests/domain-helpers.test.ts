import {
  isValidDomain,
  generateDNSRecords,
  isDomainReady,
  getDomainStatusSummary,
  shouldRedirect,
  extractSubdomain,
} from '../src/domain-helpers.js';
import type { DomainRecord } from '../src/types.js';

function makeRecord(overrides: Partial<DomainRecord> = {}): DomainRecord {
  return {
    hostname: 'example.com',
    targetDomain: 'custom.myapp.com',
    wwwEnabled: false,
    redirectMode: 'none',
    cfHostnameId: 'cf-123',
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

describe('isValidDomain', () => {
  it('accepts valid domains', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('sub.example.com')).toBe(true);
    expect(isValidDomain('my-site.co.uk')).toBe(true);
    expect(isValidDomain('a.io')).toBe(true);
  });

  it('rejects invalid domains', () => {
    expect(isValidDomain('')).toBe(false);
    expect(isValidDomain('localhost')).toBe(false);
    expect(isValidDomain('-example.com')).toBe(false);
    expect(isValidDomain('example-.com')).toBe(false);
  });

  it('strips protocol before validating', () => {
    expect(isValidDomain('https://example.com')).toBe(true);
  });
});

describe('generateDNSRecords', () => {
  it('generates apex-only records', () => {
    const records = generateDNSRecords('example.com', 'custom.myapp.com');
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      type: 'CNAME',
      name: '@',
      content: 'custom.myapp.com',
      ttl: 3600,
    });
  });

  it('generates apex + www records when www enabled', () => {
    const records = generateDNSRecords('example.com', 'custom.myapp.com', true);
    expect(records).toHaveLength(2);
    expect(records[1].name).toBe('www');
  });
});

describe('isDomainReady', () => {
  it('returns true when SSL is active', () => {
    const record = makeRecord({ sslStatus: 'active' });
    expect(isDomainReady(record)).toBe(true);
  });

  it('returns false when SSL is pending', () => {
    const record = makeRecord({ sslStatus: 'pending' });
    expect(isDomainReady(record)).toBe(false);
  });

  it('returns false when www SSL is not active but www is enabled', () => {
    const record = makeRecord({
      wwwEnabled: true,
      sslStatus: 'active',
      sslWwwStatus: 'pending',
    });
    expect(isDomainReady(record)).toBe(false);
  });

  it('returns true when both apex and www SSL are active', () => {
    const record = makeRecord({
      wwwEnabled: true,
      sslStatus: 'active',
      sslWwwStatus: 'active',
    });
    expect(isDomainReady(record)).toBe(true);
  });
});

describe('getDomainStatusSummary', () => {
  it('returns active when domain is ready', () => {
    const record = makeRecord({ dnsStatus: 'verified', sslStatus: 'active' });
    const summary = getDomainStatusSummary(record);
    expect(summary.overall).toBe('active');
  });

  it('returns failed when DNS failed', () => {
    const record = makeRecord({ dnsStatus: 'failed', error: 'DNS timeout' });
    const summary = getDomainStatusSummary(record);
    expect(summary.overall).toBe('failed');
    expect(summary.message).toBe('DNS timeout');
  });

  it('returns pending with details', () => {
    const record = makeRecord({ dnsStatus: 'pending', sslStatus: 'pending' });
    const summary = getDomainStatusSummary(record);
    expect(summary.overall).toBe('pending');
    expect(summary.message).toContain('DNS verification');
    expect(summary.message).toContain('SSL certificate');
  });

  it('includes www details when enabled', () => {
    const record = makeRecord({
      wwwEnabled: true,
      dnsStatus: 'verified',
      sslStatus: 'active',
      sslWwwStatus: 'active',
    });
    const summary = getDomainStatusSummary(record);
    expect(summary.details.dns.www).toBeDefined();
    expect(summary.details.ssl.www).toBeDefined();
  });
});

describe('shouldRedirect', () => {
  it('does not redirect when mode is none', () => {
    const record = makeRecord({ redirectMode: 'none' });
    expect(shouldRedirect(record, 'example.com')).toEqual({ redirect: false });
    expect(shouldRedirect(record, 'www.example.com')).toEqual({ redirect: false });
  });

  it('redirects apex to www when mode is apex-to-www', () => {
    const record = makeRecord({ redirectMode: 'apex-to-www' });
    const result = shouldRedirect(record, 'example.com');
    expect(result.redirect).toBe(true);
    expect(result.targetHostname).toBe('www.example.com');
  });

  it('does not redirect www when mode is apex-to-www', () => {
    const record = makeRecord({ redirectMode: 'apex-to-www' });
    expect(shouldRedirect(record, 'www.example.com')).toEqual({ redirect: false });
  });

  it('redirects www to apex when mode is www-to-apex', () => {
    const record = makeRecord({ redirectMode: 'www-to-apex' });
    const result = shouldRedirect(record, 'www.example.com');
    expect(result.redirect).toBe(true);
    expect(result.targetHostname).toBe('example.com');
  });

  it('does not redirect apex when mode is www-to-apex', () => {
    const record = makeRecord({ redirectMode: 'www-to-apex' });
    expect(shouldRedirect(record, 'example.com')).toEqual({ redirect: false });
  });
});

describe('extractSubdomain', () => {
  it('extracts subdomain from hostname', () => {
    expect(extractSubdomain('blog.example.com')).toBe('blog');
    expect(extractSubdomain('api.v2.example.com')).toBe('api');
  });

  it('returns null for apex domain', () => {
    expect(extractSubdomain('example.com')).toBeNull();
  });
});
