import { describe, expect, it } from 'vitest';
import { saveFailureMessage, translateErrorCode } from '@/lib/error-messages';
import { ApiError } from '@/lib/api';

const messages: Record<string, string> = {
  UNAUTHORIZED: 'bad credentials',
  ERROR_FORBIDDEN: 'forbidden',
  ERROR_INTERNAL_SERVER: 'generic',
};

const tErr = Object.assign((key: string) => messages[key] ?? `Errors.${key}`, {
  has: (key: string) => key in messages,
});

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

describe('saveFailureMessage', () => {
  const failed = 'Failed to save deck';

  it('names the resource and adds the API reason when the response carries a code', () => {
    expect(saveFailureMessage(new ApiError('FORBIDDEN', 403), failed, tErr)).toBe(
      'Failed to save deck forbidden',
    );
  });

  it('keeps the resource line alone for a transport failure', () => {
    expect(saveFailureMessage(new ApiError('NETWORK_ERROR', 0), failed, tErr)).toBe(failed);
  });

  it('keeps the resource line alone for an unknown error', () => {
    expect(saveFailureMessage(new Error('boom'), failed, tErr)).toBe(failed);
  });
});
