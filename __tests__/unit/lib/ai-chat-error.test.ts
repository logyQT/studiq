import { describe, expect, it } from 'vitest';
import { parseAiChatErrorCode } from '@/lib/ai-chat-error';

/**
 * `DefaultChatTransport` rejects with `new Error(await response.text())`, so the
 * raw JSON API body is the error message. The chat screen depends on this parser
 * to tell a plan/usage limit apart from a rate limit — returning `null` for
 * anything else keeps the generic alert + retry path working (#375).
 */
describe('parseAiChatErrorCode', () => {
  it('reads the app error code out of the JSON body the transport puts in message', () => {
    const error = new Error('{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}');

    expect(parseAiChatErrorCode(error)).toBe('USAGE_LIMIT_EXCEEDED');
  });

  it('keeps the RATE_LIMITED body with retryAfterMs working', () => {
    const error = new Error('{"success":false,"error":"RATE_LIMITED","retryAfterMs":42000}');

    expect(parseAiChatErrorCode(error)).toBe('RATE_LIMITED');
  });

  it('returns null for plain-text and network errors', () => {
    expect(parseAiChatErrorCode(new Error('Failed to fetch'))).toBeNull();
  });

  it('returns null when there is no error', () => {
    expect(parseAiChatErrorCode(undefined)).toBeNull();
  });

  it('returns null for JSON without a string error field', () => {
    expect(parseAiChatErrorCode(new Error('{"success":false,"error":429}'))).toBeNull();
    expect(parseAiChatErrorCode(new Error('{"success":false}'))).toBeNull();
  });
});
