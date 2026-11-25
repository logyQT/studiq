import { createElement, type EffectCallback } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayDate } from '@/components/app/dashboard/today-date';

/**
 * The suite has no DOM, so the two phases of a mount are played by hand: a static render is
 * what the server sends and what hydration must reproduce, because neither runs effects;
 * the recorded effect then runs and the component is rendered again with what it stored.
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
    (next: unknown) => {
      mount.state = next;
    },
  ],
  useEffect: (run: EffectCallback, deps: unknown) => {
    mount.effects.push({ run, deps });
  },
}));

// 23:30 UTC on a Wednesday: already Thursday in Warsaw.
const NOW = new Date('2026-11-25T23:30:00Z');
const SERVER_ZONE = 'UTC';
const BROWSER_ZONE = 'Europe/Warsaw';

function render(zone: string, locale: string): string {
  vi.stubEnv('TZ', zone);
  mount.effects.length = 0;
  return renderToStaticMarkup(createElement(TodayDate, { locale }));
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, '');

describe('TodayDate (#959)', () => {
  beforeEach(() => {
    mount.state = undefined;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('renders the same markup first on a server and a browser on different dates', () => {
    const server = render(SERVER_ZONE, 'en');
    const browser = render(BROWSER_ZONE, 'en');

    expect(browser).toBe(server);
    // A non-breaking space, so the line keeps its height until the date arrives.
    expect(text(server)).toBe(' ');
  });

  it.each([
    ['en', BROWSER_ZONE, 'Thursday, November 26'],
    ['pl', BROWSER_ZONE, 'czwartek, 26 listopada'],
    ['en', 'America/New_York', 'Wednesday, November 25'],
  ])('shows the %s date of %s once mounted', (locale, zone, expected) => {
    render(zone, locale);
    for (const effect of mount.effects) effect.run();

    expect(text(render(zone, locale))).toBe(expected);
  });

  it('formats again when the language changes', () => {
    render(BROWSER_ZONE, 'pl');

    expect(mount.effects.map((effect) => effect.deps)).toEqual([['pl']]);
  });
});
