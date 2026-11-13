/** A debounced save that a dependent request can wait on. */
export interface PendingSave {
  /** Queue `save`, restarting the debounce window. */
  schedule(save: () => Promise<unknown>): void;
  /** Run the queued save now and wait for every save already in flight. */
  flush(): Promise<void>;
  /** Drop the queued save without running it. */
  cancel(): void;
}

export function createPendingSave(delayMs = 500): PendingSave {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued: (() => Promise<unknown>) | undefined;
  // Saves run one after another so a flush always observes the newest write.
  let tail: Promise<unknown> = Promise.resolve();
  // A background save that failed is retried by the next flush: otherwise a
  // publish right after a transient failure would still send a targets-less
  // publish and be rejected.
  let retry: (() => Promise<unknown>) | undefined;

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function start(save: () => Promise<unknown>): Promise<void> {
    const result = tail.then(() => save());
    const tracked = result.then(
      () => {
        if (retry === save) retry = undefined;
        return undefined;
      },
      () => {
        retry = save;
        return undefined;
      },
    );
    tail = tracked;
    return result.then(() => undefined);
  }

  function takeRetry(): (() => Promise<unknown>) | undefined {
    const save = retry;
    retry = undefined;
    return save;
  }

  return {
    schedule(save) {
      clearTimer();
      queued = save;
      timer = setTimeout(() => {
        timer = undefined;
        const next = queued;
        queued = undefined;
        if (next) void start(next).catch(() => undefined);
      }, delayMs);
    },
    async flush() {
      clearTimer();
      const next = queued ?? retry;
      queued = undefined;
      retry = undefined;
      if (next) {
        await start(next);
        return;
      }
      await tail;
      // A save that was already in flight when the flush started can still fail
      // while we wait for it; the publish would then go out without targets and
      // be rejected, which is the bug this helper exists to prevent.
      const failed = takeRetry();
      if (failed) await start(failed);
    },
    cancel() {
      clearTimer();
      queued = undefined;
    },
  };
}

/**
 * Publish only after the target selection is persisted: the server rejects a
 * publish whose assignment has no targets yet.
 */
export async function publishWithPendingTargets(
  targets: Pick<PendingSave, 'flush'>,
  publish: () => Promise<unknown>,
): Promise<void> {
  await targets.flush();
  await publish();
}
