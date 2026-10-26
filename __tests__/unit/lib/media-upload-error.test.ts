import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import { ApiError } from '@/lib/api';
import { type MediaUploadErrorKey, mediaUploadErrorKey } from '@/lib/media-upload-error';

// #358: a rejected flashcard media upload (422 / 413) escaped the handler unhandled - the spinner
// stopped and the user saw nothing. The hook now toasts one of these messages.

describe('mediaUploadErrorKey', () => {
  it('explains a file that is too large (413)', () => {
    expect(mediaUploadErrorKey(new ApiError('ERROR_PAYLOAD_TOO_LARGE', 413))).toBe('too_large');
    expect(mediaUploadErrorKey(new ApiError('PAYLOAD_TOO_LARGE', 413))).toBe('too_large');
  });

  it('explains a disallowed file type (422)', () => {
    expect(mediaUploadErrorKey(new ApiError('UNPROCESSABLE_ENTITY', 422))).toBe('unsupported');
    expect(mediaUploadErrorKey(new ApiError('ERROR_UNPROCESSABLE_ENTITY', 422))).toBe(
      'unsupported',
    );
  });

  it('says the network is down when the request never reached the server', () => {
    expect(mediaUploadErrorKey(new ApiError('NETWORK_ERROR', 0))).toBe('offline');
  });

  it('falls back to the generic message for any other failure', () => {
    expect(mediaUploadErrorKey(new ApiError('INTERNAL_SERVER', 500))).toBe('failed');
    expect(mediaUploadErrorKey(new ApiError('UNAUTHORIZED', 401))).toBe('failed');
    expect(mediaUploadErrorKey(new Error('boom'))).toBe('failed');
    expect(mediaUploadErrorKey(undefined)).toBe('failed');
  });
});

describe('MediaUpload messages', () => {
  const keys: MediaUploadErrorKey[] = ['too_large', 'unsupported', 'offline', 'failed'];

  it.each([
    ['pl', pl],
    ['en', en],
  ])('translates every key in %s', (_locale, messages) => {
    const upload = messages.MediaUpload as Record<string, string>;

    for (const key of keys) {
      expect(upload[key], `MediaUpload.${key}`).toBeTypeOf('string');
      expect(upload[key]).not.toHaveLength(0);
    }
  });
});
