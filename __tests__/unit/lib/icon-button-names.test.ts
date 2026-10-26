import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

// #253: icon-only buttons (<Button size="icon...">) whose only child is an aria-hidden icon have an
// empty accessible name, so a screen reader announces just "button". Every one in apps/web must
// carry a name: aria-label, an <SrLabel>, visible text, or an <a aria-label> when rendered asChild.

const ROOT = 'apps/web/src';

/** Title-only toggles owned by the language / theme switcher rework (#634, #635). */
const KNOWN_TITLE_ONLY = [
  'components/layout/LanguageToggle.tsx',
  'components/layout/ThemeToggle.tsx',
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** End of the opening tag that starts at `start` (a `>` outside braces, not part of `=>`). */
function openingTagEnd(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && src[i - 1] !== '=') return i;
  }
  return src.length - 1;
}

function unnamedIconButtons(): string[] {
  const unnamed: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const open = /<Button\b/g;
    for (let m = open.exec(src); m; m = open.exec(src)) {
      const end = openingTagEnd(src, m.index);
      const tag = src.slice(m.index, end + 1);
      if (!/size=["']icon/.test(tag)) continue;
      const close = tag.endsWith('/>') ? end : src.indexOf('</Button>', end);
      const inner = src.slice(end + 1, close);
      const visibleText = inner
        .replace(/<[^>]*>/g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/[{}\s]/g, '');
      const named =
        /aria-label|aria-labelledby/.test(tag) ||
        inner.includes('<SrLabel') ||
        /aria-label=/.test(inner) ||
        visibleText.length > 0;
      if (!named) {
        const line = src.slice(0, m.index).split('\n').length;
        unnamed.push(`${rel}:${line}`);
      }
    }
  }
  return unnamed.filter((entry) => !KNOWN_TITLE_ONLY.some((known) => entry.startsWith(known)));
}

describe('icon-only buttons have an accessible name (#253)', () => {
  it('every <Button size="icon"> in apps/web is named', () => {
    expect(unnamedIconButtons()).toEqual([]);
  });
});

describe('A11y messages', () => {
  const keys = [
    'remove_row',
    'copy_invite_link',
    'remove_member',
    'role_permissions',
    'edit_role',
    'delete_role',
    'stop_generating',
    'send_message',
    'dismiss_checklist',
    'start_cram',
    'more_actions_for',
    'more_actions_flashcard',
    'more_actions_deck',
    'edit_group',
    'delete_group',
    'back',
    'remove_answer',
    'clear_selection',
  ];

  it.each([
    ['pl', pl],
    ['en', en],
  ])('translates every label in %s', (_locale, messages) => {
    const a11y = messages.A11y as Record<string, string>;

    for (const key of keys) {
      expect(a11y[key], `A11y.${key}`).toBeTypeOf('string');
      expect(a11y[key]).not.toHaveLength(0);
    }
  });

  it('keeps the row placeholders the call sites pass', () => {
    const a11y = pl.A11y as Record<string, string>;

    expect(a11y.remove_row).toContain('{number}');
    expect(a11y.remove_answer).toContain('{number}');
    for (const key of ['remove_member', 'role_permissions', 'edit_role', 'delete_role']) {
      expect(a11y[key]).toContain('{name}');
    }
  });
});
