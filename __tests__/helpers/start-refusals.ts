import type { AppErrorCode } from '@studiq/server/lib/errors';

/**
 * Every refusal `POST /api/v1/assignments/:id/start` answers with a bare code (#1258/#1273):
 * the window (`ATTEMPTS_CLOSED`, `ATTEMPTS_NOT_OPEN`), the budget (`NO_ATTEMPTS_LEFT`), the
 * inventory (`NO_UNSEEN_ITEMS`), a cancelled run (`ASSESSMENT_CANCELLED`) and the generic paths
 * `NOT_FOUND` from the targeting guard, `INTERNAL_SERVER` from a corrupt snapshot.
 *
 * The student detail page renders each one through `translateErrorCode`, so every entry needs
 * copy in both catalogues and a message on screen.
 */
export const START_REFUSAL_CODES = [
  'NOT_FOUND',
  'INTERNAL_SERVER',
  'ASSESSMENT_CANCELLED',
  'ATTEMPTS_CLOSED',
  'ATTEMPTS_NOT_OPEN',
  'NO_ATTEMPTS_LEFT',
  'NO_UNSEEN_ITEMS',
] as const satisfies readonly AppErrorCode[];
