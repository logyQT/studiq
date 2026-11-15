import type { JournalEntry, Outcome } from './types';

/** Everything the engine knows about a request before it starts answering. */
export interface JournalStart {
  outcome: Outcome;
  fixture: string | null;
  conversation: string | null;
  turn: number | null;
  fault: string | null;
  request: unknown;
}

/**
 * Per-request record of what the engine decided and wrote. Specs read it to
 * assert request counts, the exact payload the app sent and the bytes the app
 * received, which is what makes a bad-model-output case checkable.
 */
export class Journal {
  private entries: JournalEntry[] = [];
  private nextId = 1;

  /** Opens an entry; `wire` and `durationMs` fill in as the response is written. */
  open(start: JournalStart): JournalEntry {
    const entry: JournalEntry = { ...start, id: this.nextId++, wire: '', durationMs: 0 };
    this.entries.push(entry);
    return entry;
  }

  list(): readonly JournalEntry[] {
    return this.entries;
  }

  get(id: number): JournalEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  reset(): void {
    this.entries = [];
    this.nextId = 1;
  }
}
