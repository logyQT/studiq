import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftSaver } from '@/lib/quiz-draft-saver';

const DELAY = 500;

/** A saver whose saves the test settles by hand, in the order they started. */
function setup() {
  const started: string[] = [];
  const settlers: Array<{ ok: () => void; fail: () => void }> = [];
  const put = vi.fn((body: string) => {
    started.push(body);
    return new Promise<void>((resolve, reject) => {
      settlers.push({ ok: () => resolve(), fail: () => reject(new Error('offline')) });
    });
  });
  const flush = vi.fn();
  const onFailure = vi.fn();
  const saver = createDraftSaver({ put, flush, onFailure, delayMs: DELAY });
  saver.markSaved('seed');

  /** Settles the oldest open save and lets the queue move on. */
  async function settle(result: 'ok' | 'fail' = 'ok') {
    const next = settlers.shift();
    if (!next) throw new Error('no save is open');
    next[result]();
    await vi.advanceTimersByTimeAsync(0);
  }
  const wait = (ms = DELAY) => vi.advanceTimersByTimeAsync(ms);

  return { saver, started, flush, onFailure, put, settle, wait };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createDraftSaver (#1547)', () => {
  it('saves nothing before the restored state is known', async () => {
    const put = vi.fn(() => Promise.resolve());
    const flush = vi.fn();
    const saver = createDraftSaver({ put, flush, onFailure: vi.fn(), delayMs: DELAY });

    saver.change('a');
    await vi.advanceTimersByTimeAsync(DELAY);
    saver.leave();

    expect(put).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('saves only the newest answers, after a pause', async () => {
    const { saver, started, wait } = setup();

    saver.change('a');
    await wait(DELAY - 1);
    saver.change('ab');
    await wait(DELAY - 1);
    expect(started).toEqual([]);
    await wait(1);

    expect(started).toEqual(['ab']);
  });

  it('does not write the restored state back', async () => {
    const { saver, started, flush, wait } = setup();

    saver.change('seed');
    await wait();
    saver.leave();

    expect(started).toEqual([]);
    expect(flush).not.toHaveBeenCalled();
  });

  it('sends the unsaved answers when the page goes away before the pause ends', async () => {
    const { saver, flush, started, wait } = setup();

    saver.change('a');
    saver.leave();
    await wait();

    expect(flush).toHaveBeenCalledExactlyOnceWith('a');
    expect(started, 'the cancelled timer sends nothing later').toEqual([]);
  });

  it('sends nothing on leaving once the server has the answers', async () => {
    const { saver, flush, settle, wait } = setup();

    saver.change('a');
    await wait();
    await settle();
    saver.leave();

    expect(flush).not.toHaveBeenCalled();
  });

  it('does not send a state the student has gone back from', async () => {
    const { saver, flush, started, wait } = setup();

    saver.change('a');
    saver.change('seed');
    await wait();
    saver.leave();

    expect(started).toEqual([]);
    expect(flush).not.toHaveBeenCalled();
  });

  it('runs saves one after another, so an older one cannot land last', async () => {
    const { saver, started, settle, wait } = setup();

    saver.change('a');
    await wait();
    saver.change('ab');
    await wait();
    expect(started, 'the second waits for the first').toEqual(['a']);
    await settle();

    expect(started).toEqual(['a', 'ab']);
  });

  it('saves a return to the confirmed answers while a newer save is on its way', async () => {
    const { saver, started, settle, wait } = setup();

    saver.change('a');
    await wait();
    saver.change('seed');
    await wait();
    await settle();

    expect(started).toEqual(['a', 'seed']);
  });

  it('reports one failure per streak and sends the answers again on leaving', async () => {
    const { saver, onFailure, flush, settle, wait } = setup();

    saver.change('a');
    await wait();
    await settle('fail');
    saver.change('ab');
    await wait();
    await settle('fail');

    expect(onFailure).toHaveBeenCalledTimes(1);
    saver.leave();
    expect(flush).toHaveBeenCalledExactlyOnceWith('ab');
  });

  it('reports a new failure after a save worked again', async () => {
    const { saver, onFailure, settle, wait } = setup();

    for (const [body, result] of [
      ['a', 'fail'],
      ['b', 'ok'],
      ['c', 'fail'],
    ] as const) {
      saver.change(body);
      await wait();
      await settle(result);
    }

    expect(onFailure).toHaveBeenCalledTimes(2);
  });

  it('after a stop starts no save, sends nothing on leaving and reports no refusal', async () => {
    const { saver, started, flush, onFailure, settle, wait } = setup();

    saver.change('a');
    await wait();
    saver.change('ab');
    saver.stop();
    await settle('fail');
    await wait();
    saver.leave();

    expect(started).toEqual(['a']);
    expect(flush).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('saves the pending answers when a failed submission resumes the attempt', async () => {
    const { saver, started, wait } = setup();

    saver.change('a');
    saver.stop();
    await wait();
    saver.resume();
    await wait(0);

    expect(started).toEqual(['a']);
  });
});
