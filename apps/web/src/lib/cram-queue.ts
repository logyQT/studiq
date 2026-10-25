/**
 * Cram queue semantics (#617).
 *
 * Cram consumes its queue from the front and is side-effect-free: nothing here
 * talks to the API, it only decides which card the session shows next.
 *
 * The four-button mapping is the operator-approved one (`#606`):
 *   1 „Nie pamiętam (reset)" → re-queue the card, it comes back later
 *   2 „Trudne (zostań)"      → repeat the same card now
 *   3 „Dobrze (dalej)"       → the card is done for this session
 *   4 „Łatwe (zakończ)"      → the card is done for this session
 *
 * `next` and `remove` therefore share their queue effect, which is inherent in
 * the approved mapping („dalej" / „zakończ"); the labels still communicate intent.
 * Re-inserting at the literal front would make `reset` indistinguishable from
 * `stay`, so `reset` re-queues at the *end* — that is the only implementation
 * that keeps the four actions meaningfully distinct.
 */
export type CramAction = 'reset' | 'stay' | 'next' | 'remove';

export function applyCramAction<T>(queue: T[], action: CramAction): T[] {
  if (queue.length === 0) return queue;

  switch (action) {
    case 'stay':
      return queue;
    case 'reset':
      return queue.length > 1 ? [...queue.slice(1), queue[0]] : queue;
    case 'next':
      return queue.slice(1);
    case 'remove':
      return queue.slice(1);
  }
}

/** Maps the 1–4 rating buttons to their cram queue action. */
export function cramActionForRating(confidenceLevel: number): CramAction {
  switch (confidenceLevel) {
    case 1:
      return 'reset';
    case 2:
      return 'stay';
    case 3:
      return 'next';
    default:
      return 'remove';
  }
}
