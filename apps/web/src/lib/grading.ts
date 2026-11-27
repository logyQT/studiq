export interface GradeDraft {
  points: string;
  feedback: string;
}

export interface SavedGrade {
  teacher_points: number | null;
  teacher_feedback: string | null;
}

/** Draft (teacher input) wins per field; otherwise hydrate from the persisted grade. */
export function resolveGradeDraft(
  saved: SavedGrade | null | undefined,
  draft: Partial<GradeDraft> | undefined,
): GradeDraft {
  return {
    points: draft?.points ?? (saved?.teacher_points != null ? String(saved.teacher_points) : ''),
    feedback: draft?.feedback ?? saved?.teacher_feedback ?? '',
  };
}

/** Empty, non-numeric, negative or fractional input => null (never silently 0). */
export function parseGradePoints(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const points = Number(trimmed);
  return Number.isInteger(points) && points >= 0 ? points : null;
}

/** True when parsed points exceed a known question maximum. Missing max never caps. */
export function exceedsGradeMax(points: number | null, max: number | null | undefined): boolean {
  return points !== null && max != null && points > max;
}

/**
 * Whether one question of a submitted attempt still waits for a teacher (#1303), the rule of the
 * results list: its answer row has no points, or it has a photo and no row at all. A photo-only
 * answer is submitted as skipped, so it has no row. A question with neither was skipped.
 */
export function awaitsGrade(saved: SavedGrade | undefined, hasPhoto: boolean): boolean {
  return saved === undefined ? hasPhoto : saved.teacher_points === null;
}
