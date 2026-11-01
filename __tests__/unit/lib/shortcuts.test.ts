import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSequenceMatcher,
  isApplePlatform,
  isIgnorableKeyEvent,
  isTypingTarget,
  modifierLabels,
  NAV_SHORTCUTS,
  overlayOpen,
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

describe('isIgnorableKeyEvent (#665 review)', () => {
  it('ignores auto-repeat, so holding g never reads as g g', () => {
    expect(isIgnorableKeyEvent({ key: 'g', repeat: true })).toBe(true);
  });

  it('ignores IME composition in both forms browsers report it', () => {
    expect(isIgnorableKeyEvent({ key: 'g', isComposing: true })).toBe(true);
    expect(isIgnorableKeyEvent({ key: 'Process' })).toBe(true);
  });

  it('ignores modifier chords', () => {
    expect(isIgnorableKeyEvent({ key: 'g', ctrlKey: true })).toBe(true);
    expect(isIgnorableKeyEvent({ key: 'g', metaKey: true })).toBe(true);
    expect(isIgnorableKeyEvent({ key: 'g', altKey: true })).toBe(true);
  });

  it('lets a plain key through', () => {
    expect(isIgnorableKeyEvent({ key: 'g' })).toBe(false);
  });
});

describe('overlayOpen', () => {
  // The unit environment has no DOM: a stand-in root answers the selector the way a page would.
  const rootWith = (matches: string[]) =>
    ({
      querySelector: (selector: string) =>
        matches.some((m) => selector.includes(m)) ? ({} as Element) : null,
    }) as unknown as ParentNode;

  it('asks for an open dialog, alert dialog or menu', () => {
    const asked: string[] = [];
    const root = {
      querySelector: (selector: string) => {
        asked.push(selector);
        return null;
      },
    } as unknown as ParentNode;

    expect(overlayOpen(root)).toBe(false);
    for (const role of ['dialog', 'alertdialog', 'menu', 'listbox']) {
      expect(asked[0]).toContain(`[role="${role}"][data-state="open"]`);
    }
  });

  it('is true when such a layer exists, false otherwise', () => {
    expect(overlayOpen(rootWith(['dialog']))).toBe(true);
    expect(overlayOpen(rootWith([]))).toBe(false);
  });
});

describe('modifier labels per platform', () => {
  it('detects Apple platforms', () => {
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })).toBe(true);
    expect(isApplePlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe(
      false,
    );
    expect(isApplePlatform(undefined)).toBe(false);
  });

  it('shows ⌘ and ⌥ on Apple platforms, Ctrl and Alt elsewhere', () => {
    expect(modifierLabels(true)).toEqual({ ctrl: '⌘', alt: '⌥' });
    expect(modifierLabels(false)).toEqual({ ctrl: 'Ctrl', alt: 'Alt' });
  });
});

describe('where the guards are wired (#665 QA)', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('the study session ignores its keys while a layer is open', () => {
    const session = read('apps/web/src/app/(frontend)/app/study/session/[type]/session-client.tsx');
    expect(session).toContain('if (overlayOpen()) return;');

    // The guard must stay above everything that reacts to a key: moving it below the Space flip or
    // the 1-4 ratings would silently write a review behind an open dialog.
    const guard = session.indexOf('if (overlayOpen()) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(session.indexOf('setFlipped((prev) => !prev)'));
    expect(guard).toBeLessThan(session.indexOf("case '1'"));
  });

  it('the study session leaves Space to a focused button (#674 review)', () => {
    const session = read('apps/web/src/app/(frontend)/app/study/session/[type]/session-client.tsx');
    // The header's shortcuts button is focusable: pressing Space on it must activate the button,
    // not flip the card behind it.
    expect(session).toContain("tag === 'BUTTON'");
    expect(session).toContain("getAttribute('role') === 'button'");
    // Only Space is given up; `p` and `1`-`4` keep working while a button has focus.
    expect(session).toContain("onButton && (e.key === ' ' || e.code === 'Space')");

    // The exclusion sits after `overlayOpen()` and before anything reacts to the key (the only
    // preventDefault in the handler is the Space flip).
    const guard = session.indexOf('onButton && (e.key');
    expect(guard).toBeGreaterThan(session.indexOf('if (overlayOpen()) return;'));
    expect(guard).toBeLessThan(session.indexOf('e.preventDefault()'));
    expect(guard).toBeLessThan(session.indexOf('setFlipped((prev) => !prev)'));
    expect(guard).toBeLessThan(session.indexOf("case '1'"));
  });

  it('the global handler drops repeats and resets the pending prefix on route, blur, pointer and hide', () => {
    const global = read('apps/web/src/components/layout/global-shortcuts.tsx');
    // A long press cancels the pending prefix instead of leaving it armed.
    expect(global).toContain('if (e.repeat) {');
    const repeat = global.indexOf('if (e.repeat) {');
    expect(global.indexOf('matcher.reset();', repeat)).toBeGreaterThan(repeat);
    expect(global).toContain('isIgnorableKeyEvent(e)');
    expect(global).toContain("window.addEventListener('blur', reset)");
    expect(global).toContain("document.addEventListener('visibilitychange'");
    expect(global).toMatch(/\[matcher, pathname, open\]/);
  });

  it('the global handler resets the pending prefix on pointer input (PR #674 review)', () => {
    const global = read('apps/web/src/components/layout/global-shortcuts.tsx');
    expect(global).toContain("window.addEventListener('pointerdown', reset)");
    expect(global).toContain("window.removeEventListener('pointerdown', reset)");
    // Same handler as `blur`, not a second ad-hoc one.
    expect(global.match(/const reset = \(\) => matcher\.reset\(\);/g)).toHaveLength(1);
  });

  it('the dialog only advertises shortcuts that are live on the page', () => {
    const global = read('apps/web/src/components/layout/global-shortcuts.tsx');
    // "Go to" chords do nothing inside a study session, so the group is hidden there.
    expect(global).toContain('{area && !navDisabled && (');
    // 1-4 is one keycap, not a chord rendered with a "/" separator.
    expect(global).toContain("keys={['1–4']}");
  });
});

describe('the flashcard is keyboard operable (#674 review)', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  const flashcard = () => read('apps/web/src/components/flashcards/flashcard-flip.tsx');

  it('is a focusable group, not a button: its faces contain markdown links', () => {
    const card = flashcard();
    expect(card).toContain('tabIndex={0}');
    expect(card).toContain('role="group"');
    // A button role would make every link inside the faces presentational.
    expect(card).not.toContain('role="button"');
    expect(card).toContain('aria-keyshortcuts="Enter Space"');
  });

  it('flips on Enter and Space for the card itself only, and consumes the key', () => {
    const card = flashcard();
    // A focused link keeps its own Enter: the wrapper only handles keys that landed on itself.
    expect(card).toContain('if (e.target !== e.currentTarget) return;');
    expect(card).toContain("e.key !== 'Enter'");
    expect(card).toContain("e.code !== 'Space'");
    expect(card).toContain('e.stopPropagation();');
    expect(card.indexOf('e.stopPropagation();')).toBeLessThan(card.indexOf('onClick?.();'));
  });

  it('holding the key does not flip the card over and over', () => {
    const card = flashcard();
    // Auto-repeat is consumed (preventDefault + stopPropagation) before it can reach any handler.
    expect(card).toContain('if (e.repeat) {');
    expect(card.indexOf('if (e.repeat) {')).toBeLessThan(card.indexOf('onClick?.();'));
    expect(card.match(/e\.stopPropagation\(\);/g)).toHaveLength(2);
  });

  it('the session names the card and cannot flip it twice for one key', () => {
    const session = read('apps/web/src/app/(frontend)/app/study/session/[type]/session-client.tsx');
    expect(session).toContain("ariaLabel={t('flashcard_aria')}");

    // `defaultPrevented` sits above the overlay and focus guards: a key the card already consumed
    // can never flip it back, whatever the propagation order turns out to be.
    const handled = session.indexOf('if (e.defaultPrevented) return;');
    expect(handled).toBeGreaterThan(-1);
    expect(handled).toBeLessThan(session.indexOf('if (overlayOpen()) return;'));
    expect(handled).toBeLessThan(session.indexOf('e.preventDefault()'));
    expect(handled).toBeLessThan(session.indexOf('setFlipped((prev) => !prev)'));
  });

  it.each(['pl', 'en'])('%s: translate the card label', (locale) => {
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), `apps/web/src/i18n/messages/${locale}.json`), 'utf8'),
    );
    expect(messages.AppFlashcardSessionPage.flashcard_aria).toBeTruthy();
  });

  it('the global handler never arms a sequence on an already-handled key', () => {
    const global = read('apps/web/src/components/layout/global-shortcuts.tsx');
    const handled = global.indexOf('if (e.defaultPrevented) return;');
    expect(handled).toBeGreaterThan(-1);
    expect(handled).toBeLessThan(global.indexOf("if (e.key === '?')"));
    expect(handled).toBeLessThan(global.indexOf('matcher.press(e.key)'));
  });
});
