/**
 * Leech-ladder bookkeeping for the study session (#1063).
 *
 * The batch-practice endpoint answers with the stage each write produced, and
 * the session only prompts when that stage moved past the one the card had when
 * it was answered. Detecting that here, away from React state, keeps the rule
 * testable: a card that merely *is* a leech (an unchanged stage) must not reopen
 * the dialog on every review.
 */

/** The fields a batch-practice row must carry for transition detection. */
export interface LeechPracticeResult {
  flashcardId: string;
  leechStage: number;
  leechRestUntil: string | null;
  suspended: boolean;
}

/** What the session remembers about a card at the moment it was answered. */
export interface AnsweredCard {
  stage: number;
  /** The card front, so the dialog can name the card even if it is no longer on screen. */
  front: string;
}

/** A card whose stage moved forward on this write, queued for one dialog. */
export interface LeechTransition {
  flashcardId: string;
  front: string;
  leechRestUntil: string | null;
  suspended: boolean;
}

/**
 * The results that advanced their card's stage, in result order. A result with
 * no recorded pre-stage cannot prove a transition, so it is dropped. The caller
 * owns `preReview` cleanup; this function does not mutate it.
 */
export function findLeechTransitions(
  results: readonly LeechPracticeResult[],
  preReview: ReadonlyMap<string, AnsweredCard>,
): LeechTransition[] {
  return results.flatMap((result) => {
    const before = preReview.get(result.flashcardId);
    if (!before || result.leechStage <= before.stage) return [];
    return [
      {
        flashcardId: result.flashcardId,
        front: before.front,
        leechRestUntil: result.leechRestUntil,
        suspended: result.suspended,
      },
    ];
  });
}

/**
 * The index to show after the card at `suspendedIndex` leaves the visible list.
 * `currentIndex` indexes that list, so removing an earlier card shifts the same
 * card one place left; suspending the current card or a later one does not move
 * it. A negative index means the card is not in the list and changes nothing.
 */
export function indexAfterSuspension(suspendedIndex: number, currentIndex: number): number {
  if (suspendedIndex < 0 || suspendedIndex >= currentIndex) return currentIndex;
  return currentIndex - 1;
}
