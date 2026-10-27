import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSequenceMatcher,
  isTypingTarget,
  NAV_SHORTCUTS,
  type ShortcutArea,
  sequencesDisabled,
  shortcutArea,
} from '@/lib/shortcuts';

// #665: keyboard shortcuts and the `?` dialog. The pure parts are the sequence matcher, the
// guard against typing, and the table of "go to" shortcuts.

const nav = NAV_SHORTCUTS.app;

describe('createSequenceMatcher', () => {
  it('returns the href when the second key completes a sequence', () => {
    const m = createSequenceMatcher(nav);
    expect(m.press('g')).toBeNull();
    expect(m.press('d')).toBe('/app/flashcards');
  });

  it('is case-insensitive', () => {
    const m = createSequenceMatcher(nav);
    m.press('G');
    expect(m.press('D')).toBe('/app/flashcards');
  });

  it('forgets the first key after the timeout', () => {
    let now = 1000;
    const m = createSequenceMatcher(nav, 1000, () => now);
    m.press('g');
    now += 1001;
    expect(m.press('d')).toBeNull();
  });

  it('still matches right at the timeout', () => {
    let now = 1000;
    const m = createSequenceMatcher(nav, 1000, () => now);
    m.press('g');
    now += 1000;
    expect(m.press('d')).toBe('/app/flashcards');
  });

  it('does nothing for a key that starts no sequence', () => {
    const m = createSequenceMatcher(nav);
    expect(m.press('x')).toBeNull();
    expect(m.press('d')).toBeNull();
  });

  it('drops a wrong second key and does not match it later', () => {
    const m = createSequenceMatcher(nav);
    m.press('g');
    expect(m.press('x')).toBeNull();
    expect(m.press('d')).toBeNull();
  });

  it('lets a repeated first key start a new sequence (g g)', () => {
    const m = createSequenceMatcher(nav);
    m.press('g');
    m.press('g');
    expect(m.press('s')).toBe('/app/study/learn');
  });

  it('matches again after a completed sequence', () => {
    const m = createSequenceMatcher(nav);
    m.press('g');
    m.press('h');
    expect(m.press('d')).toBeNull();
    m.press('g');
    expect(m.press('q')).toBe('/app/questions');
  });

  it('can be reset', () => {
    const m = createSequenceMatcher(nav);
    m.press('g');
    m.reset();
    expect(m.press('d')).toBeNull();
  });

  it('uses the shortcuts of the given area only', () => {
    const edu = createSequenceMatcher(NAV_SHORTCUTS.edu);
    edu.press('g');
    expect(edu.press('z')).toBe('/edu/quizzes');
    edu.press('g');
    expect(edu.press('s')).toBeNull();
  });
});

describe('isTypingTarget', () => {
  const el = (tag: string, attrs: Record<string, string> = {}) => {
    const node = {
      tagName: tag.toUpperCase(),
      isContentEditable: attrs.contenteditable === 'true',
      getAttribute: (name: string) => attrs[name] ?? null,
    };
    return node as unknown as Element;
  };

  it.each(['input', 'textarea', 'select'])('is true for <%s>', (tag) => {
    expect(isTypingTarget(el(tag))).toBe(true);
  });

  it('is true for rich-text editors and ARIA text boxes', () => {
    expect(isTypingTarget(el('div', { contenteditable: 'true' }))).toBe(true);
    expect(isTypingTarget(el('div', { role: 'textbox' }))).toBe(true);
    expect(isTypingTarget(el('div', { role: 'combobox' }))).toBe(true);
    expect(isTypingTarget(el('div', { role: 'searchbox' }))).toBe(true);
  });

  it('is false for buttons, links, the body and nothing', () => {
    expect(isTypingTarget(el('button'))).toBe(false);
    expect(isTypingTarget(el('a'))).toBe(false);
    expect(isTypingTarget(el('body'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe('shortcutArea', () => {
  it.each([
    ['/app', 'app'],
    ['/app/study/learn', 'app'],
    ['/edu/questions/abc', 'edu'],
    ['/manage/members', 'manage'],
    ['/login', null],
    ['/', null],
    [null, null],
    [undefined, null],
  ])('%s -> %s', (path, area) => {
    expect(shortcutArea(path as string | null | undefined)).toBe(area);
  });
});

describe('sequencesDisabled', () => {
  it('is on inside a study session, which has its own keys', () => {
    expect(sequencesDisabled('/app/study/session/review')).toBe(true);
    expect(sequencesDisabled('/app/study/session/quiz/abc')).toBe(true);
  });

  it('is off everywhere else', () => {
    expect(sequencesDisabled('/app/study/learn')).toBe(false);
    expect(sequencesDisabled('/edu')).toBe(false);
    expect(sequencesDisabled(null)).toBe(false);
  });
});

describe('NAV_SHORTCUTS', () => {
  const areas = Object.keys(NAV_SHORTCUTS) as ShortcutArea[];
  const pagesRoot = join(process.cwd(), 'apps/web/src/app/(frontend)');

  it.each(areas)('%s: every sequence is "g" and one letter, and none repeats', (area) => {
    const sequences = NAV_SHORTCUTS[area].map((s) => s.sequence);
    for (const sequence of sequences) expect(sequence).toMatch(/^g [a-z]$/);
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it.each(areas)('%s: every target is a page that exists', (area) => {
    for (const { href } of NAV_SHORTCUTS[area]) {
      const page = join(pagesRoot, href, 'page.tsx');
      expect(existsSync(page), `${href} has no page.tsx`).toBe(true);
    }
  });

  it.each(areas)('%s: every target stays inside its own area', (area) => {
    for (const { href } of NAV_SHORTCUTS[area]) expect(href.startsWith(`/${area}`)).toBe(true);
  });

  it.each(['pl', 'en'])('%s: the dialog has a label for every shortcut', (locale) => {
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), `apps/web/src/i18n/messages/${locale}.json`), 'utf8'),
    );
    const labels = messages.Shortcuts.nav as Record<string, string>;
    for (const area of areas) {
      for (const { labelKey } of NAV_SHORTCUTS[area]) {
        expect(labels[labelKey], `${locale}: Shortcuts.nav.${labelKey}`).toBeTruthy();
      }
    }
  });
});
