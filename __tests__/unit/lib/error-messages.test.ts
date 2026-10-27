import { describe, expect, it } from 'vitest';
import { type ErrorTranslator, translateErrorCode } from '@/lib/error-messages';

const messages: Record<string, string> = {
  UNAUTHORIZED: 'bad credentials',
  ERROR_FORBIDDEN: 'forbidden',
  ERROR_INTERNAL_SERVER: 'generic',
};

const tErr = Object.assign((key: string) => messages[key] ?? `Errors.${key}`, {
  has: (key: string) => key in messages,
}) as ErrorTranslator;

describe('translateErrorCode', () => {
  it('uses an unprefixed key when the catalog has it', () => {
    expect(translateErrorCode(tErr, 'UNAUTHORIZED')).toBe('bad credentials');
  });

  it('falls back to the ERROR_-prefixed key', () => {
    expect(translateErrorCode(tErr, 'FORBIDDEN')).toBe('forbidden');
  });

  it('keeps an already prefixed code working', () => {
    expect(translateErrorCode(tErr, 'ERROR_FORBIDDEN')).toBe('forbidden');
  });

  it('returns the generic message for unknown or missing codes', () => {
    expect(translateErrorCode(tErr, 'NOPE')).toBe('generic');
    expect(translateErrorCode(tErr, undefined)).toBe('generic');
    expect(translateErrorCode(tErr, '')).toBe('generic');
  });
});
