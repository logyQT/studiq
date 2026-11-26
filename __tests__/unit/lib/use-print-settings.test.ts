import { createElement, type EffectCallback } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrintSettings } from '@/hooks/use-print-settings';

/**
 * The suite has no DOM, so the two phases of a mount are played by hand: a static render is
 * what the server sends and what hydration must reproduce, because neither runs effects;
 * the recorded effect then runs and the hook is rendered again with what it stored.
 */
interface Mount {
  state: unknown;
  effects: Array<{ run: EffectCallback; deps: unknown }>;
}

const mount = vi.hoisted((): Mount => ({ state: undefined, effects: [] }));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: unknown) => [
    mount.state ?? initial,
    // The hook passes either the next value or an updater, as React allows.
    (next: object | ((previous: unknown) => unknown)) => {
      mount.state = typeof next === 'function' ? next(mount.state ?? initial) : next;
    },
  ],
  useEffect: (run: EffectCallback, deps: unknown) => {
    mount.effects.push({ run, deps });
  },
}));

const KEY = 'assignment-print-settings';

const ALL_ON = {
  showNameField: true,
  showClassField: true,
  showDateField: true,
  showPoints: true,
  includeAnswerKey: true,
};

const ALL_OFF = {
  showNameField: false,
  showClassField: false,
  showDateField: false,
  showPoints: false,
  includeAnswerKey: false,
};

function stubStorage(entries: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  return store;
}

/** One render pass; returns what the component saw. */
function render() {
  const rendered: Array<ReturnType<typeof usePrintSettings>> = [];
  function Probe() {
    rendered.push(usePrintSettings());
    return null;
  }
  mount.effects.length = 0;
  renderToStaticMarkup(createElement(Probe));
  const [result] = rendered;
  if (!result) throw new Error('the probe did not render');
  return result;
}

/** The first render, its effects, then the render that follows them. */
function renderMounted() {
  render();
  for (const effect of mount.effects) effect.run();
  return render();
}

describe('usePrintSettings (#852)', () => {
  beforeEach(() => {
    mount.state = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is not ready on the first render, on the server and on a browser with saved settings', () => {
    // The server has no `localStorage` at all.
    const server = render();
    stubStorage({ [KEY]: JSON.stringify(ALL_OFF) });
    const browser = render();

    expect([server.settings, server.ready]).toEqual([ALL_ON, false]);
    expect([browser.settings, browser.ready]).toEqual([server.settings, server.ready]);
  });

  it('ignores a change and a save before the read, so the saved entry stays', () => {
    const saved = JSON.stringify(ALL_OFF);
    const store = stubStorage({ [KEY]: saved });

    render().updateSetting('showPoints', true);

    expect(render().ready).toBe(false);
    expect(render().saveSettings()).toBe(false);
    expect(store.get(KEY)).toBe(saved);
  });

  it('loads the saved settings once mounted', () => {
    stubStorage({ [KEY]: JSON.stringify(ALL_OFF) });

    expect(renderMounted()).toMatchObject({ settings: ALL_OFF, ready: true });
  });

  it('reads storage on mount only, so a later render cannot undo an unsaved change', () => {
    stubStorage();
    render();

    expect(mount.effects.map((effect) => effect.deps)).toEqual([[]]);
  });

  it('keeps the default for a setting the saved entry does not have', () => {
    stubStorage({ [KEY]: JSON.stringify({ showPoints: false }) });

    expect(renderMounted().settings).toEqual({ ...ALL_ON, showPoints: false });
  });

  it('updates one setting and keeps the others, without saving it', () => {
    const saved = JSON.stringify(ALL_OFF);
    const store = stubStorage({ [KEY]: saved });

    renderMounted().updateSetting('showClassField', true);

    expect(render().settings).toEqual({ ...ALL_OFF, showClassField: true });
    expect(store.get(KEY)).toBe(saved);
  });

  it('saves the current settings, which the next mount loads', () => {
    const store = stubStorage();
    renderMounted().updateSetting('includeAnswerKey', false);

    expect(render().saveSettings()).toBe(true);
    expect(JSON.parse(store.get(KEY) ?? '')).toEqual({ ...ALL_ON, includeAnswerKey: false });

    mount.state = undefined;
    expect(renderMounted().settings).toEqual({ ...ALL_ON, includeAnswerKey: false });
  });

  it.each([
    ['no entry', {}],
    ['an empty entry', { [KEY]: '' }],
    ['malformed JSON', { [KEY]: '{"showPoints":' }],
    ['a JSON null', { [KEY]: 'null' }],
    ['a JSON string', { [KEY]: '"off"' }],
    ['a JSON array', { [KEY]: '[false]' }],
  ])('falls back to the defaults with %s', (_, entries) => {
    stubStorage(entries);

    expect(renderMounted()).toMatchObject({ settings: ALL_ON, ready: true });
  });

  it('takes only the boolean values of the known settings, and saves only those', () => {
    const entry = { showNameField: 'false', showClassField: 0, showDateField: null };
    const store = stubStorage({
      [KEY]: JSON.stringify({ ...entry, showPoints: false, unknown: false }),
    });

    const mounted = renderMounted();

    expect(mounted.settings).toStrictEqual({ ...ALL_ON, showPoints: false });
    mounted.saveSettings();
    expect(JSON.parse(store.get(KEY) ?? '')).toStrictEqual({ ...ALL_ON, showPoints: false });
  });

  it.each(['QuotaExceededError', 'SecurityError'])(
    'reports a save that storage refuses with %s and keeps the choice',
    (name) => {
      vi.stubGlobal('localStorage', {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('refused', name);
        },
      });
      renderMounted().updateSetting('showPoints', false);

      expect(render().saveSettings()).toBe(false);
      expect(render().settings).toEqual({ ...ALL_ON, showPoints: false });
    },
  );

  it('is ready with the defaults when the browser has no storage', () => {
    expect(renderMounted()).toMatchObject({ settings: ALL_ON, ready: true });
  });

  it('falls back to the defaults when storage cannot be read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });

    expect(renderMounted()).toMatchObject({ settings: ALL_ON, ready: true });
  });
});
