import { ApiError, isNetworkError } from '@/lib/api';

export type MediaUploadErrorKey = 'too_large' | 'unsupported' | 'offline' | 'failed';

/**
 * Which `MediaUpload.*` message explains a failed flashcard media upload. The endpoint answers
 * 413 for a file over the size limit and 422 for a type outside the allow-list; anything else
 * (500, expired session, ...) is the generic message. Rejected uploads used to show nothing at
 * all (#358).
 */
export function mediaUploadErrorKey(error: unknown): MediaUploadErrorKey {
  if (isNetworkError(error)) return 'offline';
  if (error instanceof ApiError) {
    if (error.status === 413 || error.code.includes('PAYLOAD_TOO_LARGE')) return 'too_large';
    if (error.status === 422 || error.code.includes('UNPROCESSABLE_ENTITY')) return 'unsupported';
  }
  return 'failed';
}
