export interface DraftSaverDeps {
  /** Save one draft body; rejects when the server did not take it. */
  put: (body: string) => Promise<void>;
  /** Send a body as the page goes away: it must outlive the page. */
  flush: (body: string) => void;
  /** The first failure of a streak, so a dead endpoint cannot repeat the message. */
  onFailure: () => void;
  delayMs: number;
}

/**
 * Autosave of one attempt's answers (#349, #1547). A body is the whole answer set, so only the
 * newest one matters.
 *
 * - Nothing is saved before `markSaved` gives the state the server already has.
 * - Saves run one after another: an older body cannot land after a newer one.
 * - `pending` is the newest body the server has not confirmed. Going back to an earlier answer
 *   replaces it, so a leave never sends a state the student has left.
 * - A leave sends past the queue. It drops the saves that have not started, and repeats its
 *   body after one that has, which can otherwise arrive last.
 */
export function createDraftSaver({ put, flush, onFailure, delayMs }: DraftSaverDeps) {
  /** The body the server is known to hold; null while a newer save has no answer. */
  let confirmed: string | null = null;
  /** The last body handed to the queue; the server will have it unless the save fails. */
  let queued: string | null = null;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let failing = false;
  let queue: Promise<void> = Promise.resolve();
  /** Saves are numbered: only the answer to the newest one says what the server holds. */
  let newest = 0;
  /** Saves numbered below this were overtaken by a leave and must not start. */
  let firstWanted = 0;
  let inFlight = false;

  /** Read through a call: `stop` can run while a save is waiting for its answer. */
  const isStopped = (): boolean => stopped;

  async function save(body: string, number: number): Promise<void> {
    if (isStopped() || number < firstWanted) return;
    inFlight = true;
    try {
      await put(body);
      if (number === newest) {
        confirmed = body;
        if (pending === body) pending = null;
      }
      failing = false;
    } catch {
      // After a stop the refusal is expected: the submission has completed the attempt.
      if (isStopped() || failing) return;
      failing = true;
      onFailure();
    } finally {
      inFlight = false;
    }
  }

  function send(body: string): void {
    queued = body;
    confirmed = null;
    newest += 1;
    const number = newest;
    queue = queue.then(() => save(body, number));
  }

  return {
    markSaved(body: string): void {
      clearTimeout(timer);
      confirmed = body;
      queued = body;
      pending = null;
    },
    change(body: string): void {
      if (queued === null) return;
      clearTimeout(timer);
      if (body === queued) {
        // Nothing new to queue. It stays pending until the server confirms it.
        pending = body === confirmed ? null : body;
        return;
      }
      pending = body;
      timer = setTimeout(() => send(body), delayMs);
    },
    /** The page is going away: send what the server has not confirmed. */
    leave(): void {
      clearTimeout(timer);
      if (stopped || pending === null) return;
      firstWanted = newest + 1;
      flush(pending);
      queued = pending;
      confirmed = null;
      // Leaving inside the app keeps this code running, so the repeat still goes out. After a
      // reload or a closed tab it never does, and the leave request stands alone.
      if (inFlight) send(pending);
    },
    /** Before a submission: no save may start or report a failure from here on. */
    stop(): void {
      stopped = true;
      clearTimeout(timer);
    },
    /** After a failed submission: the attempt is still running. */
    resume(): void {
      stopped = false;
      if (pending !== null) send(pending);
    },
  };
}
