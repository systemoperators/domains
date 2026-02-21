import { normalizeDomain } from '../src/dns.js';

describe('normalizeDomain', () => {
  it('lowercases domain', () => {
    expect(normalizeDomain('Example.COM')).toBe('example.com');
  });

  it('strips https protocol', () => {
    expect(normalizeDomain('https://example.com')).toBe('example.com');
  });

  it('strips http protocol', () => {
    expect(normalizeDomain('http://example.com')).toBe('example.com');
  });

  it('strips trailing slash', () => {
    expect(normalizeDomain('example.com/')).toBe('example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeDomain('  example.com  ')).toBe('example.com');
  });

  it('handles all together', () => {
    expect(normalizeDomain('  HTTPS://Example.Com/  ')).toBe('example.com');
  });
});
