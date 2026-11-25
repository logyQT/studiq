import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #1166 — `packages/ui` declares `"sideEffects": false`, so a bundler may drop any of its modules
 * whose exports nothing uses, and with them that module's third-party dependency
 * (`react-day-picker`, `react-resizable-panels`, `@radix-ui/react-scroll-area`: ~38 KB gzip of
 * dead JS on every page before the field existed).
 *
 * The claim is package-wide, so it must stay true. The usual way to break it is a module that
 * does something just by being imported: a CSS import, or a bare `import 'x'` (a polyfill, a
 * registration). Either would be silently pruned from a tree-shaken consumer build. This guard
 * fails the moment one is added; a module that really needs one must be listed in the
 * `sideEffects` array instead of the claim being weakened by accident.
 */

const UI_ROOT = fileURLToPath(new URL('../../../packages/ui/', import.meta.url));

/** A bare `import 'x'` (or `import "x"`): it is imported for what it does, not for an export. */
const BARE_IMPORT = /^\s*import\s+['"][^'"]+['"]/;
/** A style sheet imported in any form (`.css`, `.scss`, `.sass`, `.less`), bare or with a binding. */
const STYLE_IMPORT = /^\s*import\b[^\n]*['"][^'"]+\.(?:css|scss|sass|less)['"]/;

/** The lines of `source` that make a module do something by merely being imported. */
function sideEffectImports(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => BARE_IMPORT.test(line) || STYLE_IMPORT.test(line))
    .map((line) => line.trim());
}

function sourceFiles(): string[] {
  const src = join(UI_ROOT, 'src');
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(?:ts|tsx)$/.test(name))
    .map((name) => join(src, name));
}

describe('packages/ui side effects (#1166)', () => {
  it('declares "sideEffects": false', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(UI_ROOT, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({ sideEffects: false });
  });

  it('reads the source tree (the guard below is not vacuous)', () => {
    expect(sourceFiles().length).toBeGreaterThan(50);
  });

  it('has no module that does something just by being imported', () => {
    const offenders = sourceFiles().flatMap((file) =>
      sideEffectImports(readFileSync(file, 'utf8')).map(
        (line) => `${file.slice(UI_ROOT.length)}: ${line}`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});

describe('sideEffectImports', () => {
  it.each([
    "import 'polyfill';",
    'import "core-js/stable";',
    "import '@/styles/global.css';",
    "import styles from 'pkg/button.module.css';",
    "import 'pkg/theme.scss'",
  ])('flags %s', (line) => {
    expect(sideEffectImports(line)).toHaveLength(1);
  });

  it.each([
    "import { clsx } from 'clsx';",
    "import * as React from 'react';",
    "import type { Foo } from 'pkg/foo';",
    "import dayjs from 'dayjs';",
    "const lazy = import('pkg/chart');",
    "export * from 'pkg/button';",
  ])('lets %s through', (line) => {
    expect(sideEffectImports(line)).toEqual([]);
  });
});
