export type ShortcutArea = 'app' | 'edu' | 'manage';

export interface NavShortcut {
  /** Two keys pressed one after the other, e.g. `g d`. */
  sequence: string;
  href: string;
  /** Message key inside `Shortcuts.nav`. */
  labelKey: string;
}

/**
 * "Go to" shortcuts (`g` then a letter), per area of the app. Every `href` is a real page; a
 * test keeps it that way. Letters are mnemonic in English and Polish where possible.
 */
export const NAV_SHORTCUTS: Record<ShortcutArea, NavShortcut[]> = {
  app: [
    { sequence: 'g h', href: '/app', labelKey: 'home' },
    { sequence: 'g d', href: '/app/flashcards', labelKey: 'decks' },
    { sequence: 'g s', href: '/app/study/learn', labelKey: 'study' },
    { sequence: 'g q', href: '/app/questions', labelKey: 'questions' },
    { sequence: 'g a', href: '/app/assignments', labelKey: 'assignments' },
    { sequence: 'g t', href: '/app/stats/activity', labelKey: 'stats' },
  ],
  edu: [
    { sequence: 'g h', href: '/edu', labelKey: 'home' },
    { sequence: 'g d', href: '/edu/flashcards', labelKey: 'decks' },
    { sequence: 'g q', href: '/edu/questions', labelKey: 'questions' },
    { sequence: 'g z', href: '/edu/quizzes', labelKey: 'quizzes' },
    { sequence: 'g a', href: '/edu/assignments', labelKey: 'assignments' },
    { sequence: 'g g', href: '/edu/groups', labelKey: 'groups' },
    { sequence: 'g t', href: '/edu/statistics', labelKey: 'stats' },
  ],
  manage: [
    { sequence: 'g h', href: '/manage', labelKey: 'home' },
    { sequence: 'g m', href: '/manage/members', labelKey: 'members' },
    { sequence: 'g i', href: '/manage/invites', labelKey: 'invites' },
    { sequence: 'g g', href: '/manage/groups', labelKey: 'groups' },
    { sequence: 'g r', href: '/manage/roles', labelKey: 'roles' },
    { sequence: 'g s', href: '/manage/settings', labelKey: 'settings' },
  ],
};

/** Area of the app a pathname belongs to, or `null` outside the three dashboards. */
export function shortcutArea(pathname: string | null | undefined): ShortcutArea | null {
  const first = (pathname ?? '').split('/')[1];
  return first === 'app' || first === 'edu' || first === 'manage' ? first : null;
}

/**
 * True when the keyboard belongs to the user's typing (or to a widget that uses the keys itself):
 * text fields, selects, rich-text editors and ARIA text boxes. Shortcuts must never fire there.
 */
export function isTypingTarget(element: Element | null | undefined): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((element as HTMLElement).isContentEditable) return true;
  const role = element.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

/** A modal or menu is open: the page behind it must not react to letters or digits. */
export function overlayOpen(root: ParentNode = document): boolean {
  return !!root.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
  );
}

export interface KeyEventLike {
  key: string;
  repeat?: boolean;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * Key events that are never a shortcut: a modifier chord, an auto-repeat (holding `g` must not
 * read as `g g`) and input-method composition (`isComposing`, or the `Process` key some
 * browsers report instead).
 */
export function isIgnorableKeyEvent(e: KeyEventLike): boolean {
  return !!(e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing || e.key === 'Process');
}

/** macOS and iOS show ⌘ and ⌥ where other platforms show Ctrl and Alt. */
export function isApplePlatform(
  nav: { platform?: string; userAgent?: string } | undefined,
): boolean {
  return /mac|iphone|ipad|ipod/i.test(`${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`);
}

export function modifierLabels(apple: boolean): { ctrl: string; alt: string } {
  return apple ? { ctrl: '⌘', alt: '⌥' } : { ctrl: 'Ctrl', alt: 'Alt' };
}

/** Pages where the keyboard is already busy (the study session uses Space and 1-4). */
export function sequencesDisabled(pathname: string | null | undefined): boolean {
  return (pathname ?? '').startsWith('/app/study/session');
}

export interface SequenceMatcher {
  /** Feed a pressed key. Returns the href when it completes a sequence, otherwise `null`. */
  press(key: string): string | null;
  reset(): void;
}

/**
 * Matches two-key sequences such as `g d`. The first key arms the matcher; the second must come
 * within `timeoutMs` or the sequence is forgotten. A wrong second key is dropped, but if it is
 * itself a first key (`g g`) it arms a new sequence instead of being lost.
 */
export function createSequenceMatcher(
  shortcuts: readonly NavShortcut[],
  timeoutMs = 1000,
  now: () => number = Date.now,
): SequenceMatcher {
  const targets = new Map(shortcuts.map((s) => [s.sequence, s.href]));
  const prefixes = new Set(shortcuts.map((s) => s.sequence.split(' ')[0]));
  let pending: { key: string; at: number } | null = null;

  return {
    press(rawKey) {
      const key = rawKey.toLowerCase();
      const at = now();

      if (pending && at - pending.at <= timeoutMs) {
        const href = targets.get(`${pending.key} ${key}`);
        pending = null;
        if (href) return href;
      } else {
        pending = null;
      }

      if (prefixes.has(key)) pending = { key, at };
      return null;
    },
    reset() {
      pending = null;
    },
  };
}
