import { ApiError, isNetworkError } from '@/lib/api';

/** The slice of a next-intl translator (`useTranslations('Errors')`) the resolver needs. */
export type ErrorTranslator = {
  (key: string): string;
  has: (key: string) => boolean;
};

const FALLBACK_KEY = 'ERROR_INTERNAL_SERVER';

/**
 * Resolve an API error code to a message from the `Errors` namespace.
 *
 * The API returns codes both bare (`INTERNAL_SERVER`, `FORBIDDEN` from `withAuth`) and
 * `ERROR_`-prefixed (`APP_ERRORS[...].code`), while a few catalog keys are bare
 * (`UNAUTHORIZED`, `VALIDATION_*`). Tries the code as-is, then `ERROR_<code>`, then a
 * generic message — never the raw `Errors.<code>` key.
 */
export function translateErrorCode(tErr: ErrorTranslator, code: string | null | undefined): string {
  if (code) {
    if (tErr.has(code)) return tErr(code);
    const prefixed = `ERROR_${code}`;
    if (tErr.has(prefixed)) return tErr(prefixed);
  }
  return tErr(FALLBACK_KEY);
}

/**
 * The inline copy a content form shows when its save is refused: the resource's own failure
 * line, plus the API's reason when the response carries an error code the catalog translates.
 * A transport failure carries no server reason, so it keeps the plain failure line.
 */
export function saveFailureMessage(error: unknown, failed: string, tErr: ErrorTranslator): string {
  if (isNetworkError(error) || !(error instanceof ApiError) || error.code === '') return failed;
  return `${failed} ${translateErrorCode(tErr, error.code)}`;
}
