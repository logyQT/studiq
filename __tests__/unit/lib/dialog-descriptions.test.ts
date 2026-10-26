import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// #250: Radix logs "Missing `Description` or `aria-describedby={undefined}` for {DialogContent}"
// every time a dialog that has a title but no description is opened. Every dialog must either
// render a description or opt out explicitly with `aria-describedby={undefined}`.

const ROOTS = ['apps/web/src', 'apps/admin/src', 'packages/ui/src'];
const KINDS: [tag: string, description: string][] = [
  ['DialogContent', 'DialogDescription'],
  ['AlertDialogContent', 'AlertDialogDescription'],
  ['SheetContent', 'SheetDescription'],
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function dialogsWithoutDescription(): string[] {
  const missing: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      // The shared wrappers (components/ui/*) forward props; they are not dialogs themselves.
      if (file.split(path.sep).join('/').includes('components/ui/')) continue;

      const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      for (const [tag, description] of KINDS) {
        const open = new RegExp(`<${tag}(\\s|>)`, 'g');
        for (let match = open.exec(src); match; match = open.exec(src)) {
          const closing = src.indexOf(`</${tag}>`, match.index);
          const block = src.slice(match.index, closing < 0 ? match.index + 3000 : closing);
          const openingTag = src.slice(match.index, src.indexOf('>', match.index) + 1);
          // A description may also sit just before the content (e.g. an sr-only header).
          const before = src.slice(Math.max(0, match.index - 400), match.index);
          const described =
            block.includes(description) ||
            before.includes(description) ||
            openingTag.includes('aria-describedby');
          if (!described) {
            const line = src.slice(0, match.index).split('\n').length;
            missing.push(`${file.split(path.sep).join('/')}:${line} <${tag}>`);
          }
        }
      }
    }
  }
  return missing;
}

describe('dialog descriptions (#250)', () => {
  it('every dialog renders a description or opts out with aria-describedby={undefined}', () => {
    expect(dialogsWithoutDescription()).toEqual([]);
  });
});
