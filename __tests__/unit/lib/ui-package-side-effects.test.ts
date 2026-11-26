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
 * The claim is package-wide, so it must stay true, and it covers more than imports: nothing in the
 * package may do something just by being imported. A CSS import or a bare `import 'x'` (a
 * polyfill, a registration) is the obvious way to break it; so is any top-level statement that runs
 * when the module loads — an `if` that touches `document`, a `navigator.serviceWorker.register(...)`
 * call, a loop, an assignment. A tree-shaken consumer build drops such a module and its effect with
 * it. This guard fails on the offending file and line for both shapes. A module that really needs
 * an effect is the exception: list it in the `sideEffects` array **and** teach this guard to skip
 * it, instead of letting the claim be weakened by accident.
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

/** Declarations: module-level statements that are not themselves an effect. */
const DECLARATION =
  /^(?:export|import|const|let|var|type|interface|function|class|enum|namespace|declare)\b/;
/** Declarations whose signature and body cannot run at import time. */
const INERT_DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:declare\s+)?(?:function|class|interface|type|enum|namespace)\b/;
/** Statements whose `}` ends the statement without a trailing `;` (blocks, not object literals). */
const BLOCK_STATEMENT =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:declare\s+)?(?:function|class|interface|enum|namespace|if|for|while|switch|try|do)\b/;
/** `Thing.displayName = …`: annotating a value the module already defines, dropped harmlessly. */
const LOCAL_PROPERTY_ASSIGNMENT = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])+\s*=[^=]/;
/** Objects that only exist in a browser: touching one at module scope is an import-time effect. */
const GLOBAL_OBJECT = /\b(?:document|window|customElements|globalThis|navigator)\b/;

type Line = {
  /** 1-based, for the failure message. */
  number: number;
  raw: string;
  /** The line with comment and string/template contents blanked, so braces and tokens are code. */
  text: string;
  depth: number;
  endDepth: number;
};

/** Splits `source` into lines and tracks `{}` depth outside comments and strings. */
function codeLines(source: string): Line[] {
  const lines: Line[] = [];
  let depth = 0;
  let inBlockComment = false;
  let quote: string | null = null;

  for (const [index, raw] of source.replace(/\r\n/g, '\n').split('\n').entries()) {
    const start = depth;
    let text = '';
    for (let i = 0; i < raw.length; i += 1) {
      const char = raw[i];
      const next = raw[i + 1];
      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          i += 1;
        }
        continue;
      }
      if (quote !== null) {
        if (char === '\\') i += 1;
        else if (char === quote) {
          quote = null;
          text += ' ';
        }
        continue;
      }
      if (char === '/' && next === '/') break;
      if (char === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        text += ' ';
        continue;
      }
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      text += char;
    }
    // Only template literals may span lines; an unterminated ' or " is a stray quote in text.
    if (quote !== null && quote !== '`') quote = null;
    lines.push({ number: index + 1, raw, text, depth: start, endDepth: depth });
  }
  return lines;
}

/** Drops balanced `{…}` regions, so the scan sees a statement's own level and not a body. */
function withoutBlocks(text: string): string {
  let out = '';
  let depth = 0;
  for (const char of text) {
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out;
}

type Statement = { line: number; raw: string; text: string; depth: number };

/** Groups the module-level lines into statements, so a multi-line `const` is judged once. */
function moduleScopeStatements(source: string): Statement[] {
  const statements: Statement[] = [];
  let current: Statement | null = null;

  for (const line of codeLines(source)) {
    if (!current) {
      if (line.text.trim() === '' || line.text.trim() === ';') continue;
      current = { line: line.number, raw: line.raw.trim(), text: '', depth: line.depth };
    }
    current.text += ` ${line.text}`;
    const text = current.text.trim();
    const endsHere =
      line.endDepth === current.depth &&
      (text.endsWith(';') || (text.endsWith('}') && BLOCK_STATEMENT.test(text)));
    if (endsHere) {
      statements.push(current);
      current = null;
    }
  }
  if (current) statements.push(current);
  return statements;
}

type ModuleScopeEffect = { line: number; text: string; reason: string };

/** The module-level statements of `source` that run (or reach a global) when the module loads. */
function moduleScopeEffects(source: string): ModuleScopeEffect[] {
  const effects: ModuleScopeEffect[] = [];
  for (const statement of moduleScopeStatements(source)) {
    const text = statement.text.replace(/\s+/g, ' ').trim();
    if (text === '' || text === ';') continue;
    const global = INERT_DECLARATION.test(text) ? null : withoutBlocks(text).match(GLOBAL_OBJECT);
    if (global) {
      effects.push({
        line: statement.line,
        text: statement.raw,
        reason: `touches ${global[0]} at import time`,
      });
    } else if (!DECLARATION.test(text) && !LOCAL_PROPERTY_ASSIGNMENT.test(text)) {
      effects.push({
        line: statement.line,
        text: statement.raw,
        reason: 'runs a top-level statement',
      });
    }
  }
  return effects;
}

function sourceFiles(): string[] {
  const src = join(UI_ROOT, 'src');
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(?:ts|tsx)$/.test(name))
    .map((name) => join(src, name));
}

describe('packages/ui side effects (#1166)', () => {
  it('declares "sideEffects": false, or an array this guard was taught to allow', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(UI_ROOT, 'package.json'), 'utf8'));
    const sideEffects =
      typeof manifest === 'object' && manifest !== null && 'sideEffects' in manifest
        ? manifest.sideEffects
        : undefined;
    // An array is only valid when this guard is updated in the same change to skip those modules.
    const declared = sideEffects === false || Array.isArray(sideEffects);

    expect(declared, `sideEffects is ${JSON.stringify(sideEffects)}`).toBe(true);
  });

  it('reads the source tree (the guard below is not vacuous)', () => {
    expect(sourceFiles().length).toBeGreaterThan(50);
  });

  it('has no module that does something just by being imported', () => {
    const offenders = sourceFiles().flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const path = file.slice(UI_ROOT.length);

      return [
        ...sideEffectImports(source).map((line) => `${path}: ${line}`),
        ...moduleScopeEffects(source).map(
          (effect) => `${path}:${effect.line}: ${effect.text} (${effect.reason})`,
        ),
      ];
    });

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

describe('moduleScopeEffects', () => {
  it.each([
    [
      'an if-guarded document probe',
      "if (typeof document !== 'undefined') document.documentElement.classList.add('dark');",
      'touches document at import time',
    ],
    [
      'a loop over a document query',
      "for (const node of document.querySelectorAll('*')) node.remove();",
      'touches document at import time',
    ],
    ['a bare call', 'initPolyfill();', 'runs a top-level statement'],
    [
      'an element registration',
      "customElements.define('x-foo', Foo);",
      'touches customElements at import time',
    ],
    [
      'a service worker registration',
      "navigator.serviceWorker.register('/sw.js');",
      'touches navigator at import time',
    ],
    ['a global assignment', 'globalThis.__studiq = true;', 'touches globalThis at import time'],
    ['a window assignment', 'window.__studiq = true;', 'touches window at import time'],
    [
      'an initializer that reads the window',
      'const width = window.innerWidth;',
      'touches window at import time',
    ],
  ])('flags %s', (_name, source, reason) => {
    const effects = moduleScopeEffects(source);

    expect(effects).toHaveLength(1);
    expect(effects[0]?.line).toBe(1);
    expect(effects[0]?.reason).toBe(reason);
    expect(effects[0]?.text.length).toBeGreaterThan(0);
  });

  it.each([
    ['a const declaration', "const WIDTH = '16rem';"],
    ['a type alias', "type Variant = 'a' | 'b';"],
    ['an interface', 'interface Props {\n  open: boolean;\n}'],
    ['a function declaration', 'function useWidth() {\n  return window.innerWidth;\n}'],
    ['a component using document', "function Sheet() {\n  document.body.classList.add('open');\n}"],
    [
      'an arrow whose body touches the window',
      "const handler = () => {\n  window.removeEventListener('keydown', handler);\n};",
    ],
    ['a displayName annotation', "Sheet.displayName = 'Sheet';"],
    ['a comment mentioning document', '// never touch document here\nconst ok = true;'],
  ])('lets %s through', (_name, source) => {
    expect(moduleScopeEffects(source)).toEqual([]);
  });
});
