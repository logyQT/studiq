import { isRecord } from '@/lib/unknown-value';

/**
 * `DefaultChatTransport` turns a non-2xx reply into `new Error(await response.text())`,
 * so the raw API body — `{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}` — ends up
 * in `error.message`. This maps that transport error back to the app error code so
 * the chat can show a specific message instead of swallowing the failure.
 *
 * Returns `null` for plain-text/network errors (and a JSON body without a string
 * `error`), which render the generic chat error.
 */
export function parseAiChatErrorCode(error: Error | undefined): string | null {
  if (!error) return null;

  try {
    const body: unknown = JSON.parse(error.message);
    if (!isRecord(body) || typeof body.error !== 'string') return null;
    return body.error;
  } catch {
    return null;
  }
}
