import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPendingSave, publishWithPendingTargets } from '@/lib/assignment-publish';

describe('assignment publish ordering (#1126)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists a debounced target selection before publishing', async () => {
    const events: string[] = [];
    const save = vi.fn(() => {
      events.push('targets');
      return Promise.resolve();
    });
    const publish = vi.fn(() => {
      events.push('publish');
      return Promise.resolve();
    });
    const targets = createPendingSave();

    targets.schedule(save);
    await publishWithPendingTargets(targets, publish);

    expect(events).toEqual(['targets', 'publish']);
  });

  it('waits for an in-flight target save before publishing', async () => {
    const events: string[] = [];
    const targets = createPendingSave();

    targets.schedule(async () => {
      events.push('targets:start');
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      events.push('targets:done');
    });
    await vi.advanceTimersByTimeAsync(500);

    const publishing = publishWithPendingTargets(targets, () => {
      events.push('publish');
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['targets:start']);

    await vi.advanceTimersByTimeAsync(100);
    await publishing;
    expect(events).toEqual(['targets:start', 'targets:done', 'publish']);
  });

  it('publishes without saving when no target selection is queued', async () => {
    const save = vi.fn(() => Promise.resolve());
    const publish = vi.fn(() => Promise.resolve());
    const targets = createPendingSave();

    await publishWithPendingTargets(targets, publish);

    expect(save).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
  });

  it('does not publish when the target save fails', async () => {
    const publish = vi.fn(() => Promise.resolve());
    const targets = createPendingSave();

    targets.schedule(() => Promise.reject(new Error('targets failed')));

    await expect(publishWithPendingTargets(targets, publish)).rejects.toThrow('targets failed');
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('assignment publish after a failed background save (#1126)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries the failed save before publishing instead of sending a targets-less publish', async () => {
    const events: string[] = [];
    let attempts = 0;
    const save = vi.fn(() => {
      attempts += 1;
      events.push(`targets:${attempts}`);
      return attempts === 1 ? Promise.reject(new Error('transient')) : Promise.resolve();
    });
    const publish = vi.fn(() => {
      events.push('publish');
      return Promise.resolve();
    });
    const targets = createPendingSave();

    targets.schedule(save);
    await vi.advanceTimersByTimeAsync(500);

    await publishWithPendingTargets(targets, publish);

    expect(events).toEqual(['targets:1', 'targets:2', 'publish']);
  });
});
