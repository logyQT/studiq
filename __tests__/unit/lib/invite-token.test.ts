import { normalizeInviteToken } from '@studiq/server/lib/invite-token';
import { describe, expect, it } from 'vitest';

const CODE = 'c8a0b04e7082116c09a28ce717f83d5f';

describe('normalizeInviteToken', () => {
  it('accepts a bare 32-hex code unchanged', () => {
    expect(normalizeInviteToken(CODE)).toBe(CODE);
  });

  it('lowercases an uppercase 32-hex code (the DB column is lowercase)', () => {
    expect(normalizeInviteToken(CODE.toUpperCase())).toBe(CODE);
  });

  it('extracts the code from the absolute link „Kopiuj link” copies', () => {
    expect(normalizeInviteToken(`http://localhost:3012/join?token=${CODE}`)).toBe(CODE);
  });

  it('extracts the code from an https link with extra query params', () => {
    expect(normalizeInviteToken(`https://app.studiq.test/join?utm=x&token=${CODE}`)).toBe(CODE);
  });

  it('extracts the code from a relative /join path', () => {
    expect(normalizeInviteToken(`/join?token=${CODE}`)).toBe(CODE);
  });

  it('extracts the code from a bare token= fragment', () => {
    expect(normalizeInviteToken(`token=${CODE}`)).toBe(CODE);
  });

  it('trims surrounding whitespace and newlines', () => {
    expect(normalizeInviteToken(`  ${CODE}\n`)).toBe(CODE);
    expect(normalizeInviteToken(`\n http://localhost:3012/join?token=${CODE} \n`)).toBe(CODE);
  });

  it('decodes a percent-encoded token and never throws on malformed input', () => {
    expect(normalizeInviteToken('http://localhost/join?token=abc%20def')).toBe('abc def');
    expect(normalizeInviteToken('http://localhost/join?token=%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('returns null for a link without a token', () => {
    expect(normalizeInviteToken('http://localhost:3012/join')).toBeNull();
    expect(normalizeInviteToken('https://example.com/x')).toBeNull();
    expect(normalizeInviteToken('/join')).toBeNull();
    expect(normalizeInviteToken('http://localhost/join?token=')).toBeNull();
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(normalizeInviteToken('')).toBeNull();
    expect(normalizeInviteToken('   \n ')).toBeNull();
  });

  it('passes opaque legacy tokens through untouched', () => {
    // Integration fixtures use `valid-token-…`; normalising must not break them.
    expect(normalizeInviteToken('valid-token-123')).toBe('valid-token-123');
    expect(normalizeInviteToken('ABC-upper-opaque')).toBe('ABC-upper-opaque');
  });

  it('does not gate on 32-hex: a near-miss is left for the DB to reject', () => {
    expect(normalizeInviteToken('abc')).toBe('abc');
    expect(normalizeInviteToken(CODE.slice(0, 31))).toBe(CODE.slice(0, 31));
    expect(normalizeInviteToken(`${CODE}0`)).toBe(`${CODE}0`);
  });

  it('keeps an opaque token extracted from a link untouched', () => {
    expect(normalizeInviteToken('http://localhost/join?token=Legacy-Opaque')).toBe('Legacy-Opaque');
  });
});
