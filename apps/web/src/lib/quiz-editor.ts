/**
 * Normalize a raw `<input type="number">` value into a quiz-question weight.
 * Returns `null` when the field is empty or not a finite number, so the caller
 * can keep the previous value while the user is mid-edit (e.g. cleared field).
 * Matches the backend contract: integer, >= 0 (`BulkSaveQuizQuestionSchema`).
 */
export function parsePointsInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;

  return Math.max(0, Math.trunc(parsed));
}
