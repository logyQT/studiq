/**
 * Share (0-100) of today's new-card budget that has been introduced.
 *
 * The page used `(perDay - remainingNewCards) / perDay`, but `remainingNewCards` is capped by
 * the number of new cards that exist, so a student with 1 new card and a budget of 20 saw
 * "95%" before studying anything (#315). The introduced count is what the API reports as
 * progress.
 */
export function newCardsProgress(introduced: number, perDay: number): number {
  if (perDay <= 0) return 100;
  return Math.min(100, Math.max(0, (introduced / perDay) * 100));
}
