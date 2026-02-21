/**
 * DNS-over-HTTPS utilities
 * Uses Google and Cloudflare DoH endpoints, works in Workers/Node/Deno/Bun
 */

import type { DNSProvider, DNSRecord, DNSVerificationResult } from './types.js';

/**
 * Lookup DNS record using DNS-over-HTTPS
 */
export async function lookupDNS(
  domain: string,
  type: string,
  name: string = '@',
  provider: DNSProvider = 'google'
): Promise<string | null> {
  try {
    const fullDomain = name === '@' ? domain : `${name}.${domain}`;

    const dnsUrl = provider === 'google'
      ? `https://dns.google/resolve?name=${encodeURIComponent(fullDomain)}&type=${type}`
      : `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(fullDomain)}&type=${type}`;

    const response = await fetch(dnsUrl, {
      headers: { Accept: 'application/dns-json' },
    });

    const data = (await response.json()) as any;

    if (data.Status !== 0 || !data.Answer || data.Answer.length === 0) {
      return null;
    }

    if (type === 'CNAME') {
      const record = data.Answer.find((a: any) => a.type === 5);
      if (record) {
        return record.data.replace(/\.$/, '');
      }
    }

    if (type === 'A') {
      const record = data.Answer.find((a: any) => a.type === 1);
      if (record) {
        return record.data;
      }
    }

    if (type === 'TXT') {
      const record = data.Answer.find((a: any) => a.type === 16);
      if (record) {
        return record.data.replace(/^"|"$/g, '');
      }
    }

    return null;
  } catch (error) {
    console.error('DNS lookup error:', error);
    return null;
  }
}

/**
 * Verify CNAME record points to expected target
 */
export async function verifyCNAME(
  domain: string,
  expectedTarget: string,
  provider: DNSProvider = 'cloudflare'
): Promise<boolean> {
  try {
    const result = await lookupDNS(domain, 'CNAME', '@', provider);
    return result?.includes(expectedTarget) || false;
  } catch (error) {
    console.error(`DNS check failed for ${domain}:`, error);
    return false;
  }
}

/**
 * Verify multiple DNS records against expected values
 */
export async function verifyDNS(
  domain: string,
  expectedRecords: DNSRecord[],
  provider: DNSProvider = 'google'
): Promise<DNSVerificationResult> {
  const results = await Promise.all(
    expectedRecords.map(async (expected) => {
      const actual = await lookupDNS(domain, expected.type, expected.name, provider);
      const correct = actual === expected.content;

      return {
        type: expected.type,
        name: expected.name,
        expected: expected.content,
        actual,
        correct,
      };
    })
  );

  const verified = results.every((r) => r.correct);

  return { verified, records: results };
}

/**
 * Check if SSL certificate is responding for domain
 */
export async function checkSSL(domain: string): Promise<boolean> {
  try {
    await fetch(`https://${domain}`, {
      method: 'HEAD',
      redirect: 'manual',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize domain string (remove protocol, trailing slash, lowercase)
 */
export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}
