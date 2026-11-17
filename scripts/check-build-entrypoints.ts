#!/usr/bin/env bun
/**
 * Build-entrypoint guard, wired into `bun run lint` (see package.json).
 *
 * `apps/web` and `apps/admin` attach a `prebuild` hook that refuses a build with
 * no single-use grant (ADR-0014, decision 6), so every route through the
 * workspace `build` script is admitted. What the hook cannot cover is automation
 * that calls `next build` directly, or that reaches the workspace script without
 * the grant `env build` mints. This check reads the places automation actually
 * declares its commands — GitHub workflow `run:` steps and Playwright's
 * `webServer.command` — and fails on:
 *
 *   - `next build` (never runs `prebuild`), and
 *   - a bare `bun run build` (runs `prebuild`, but with no grant to consume).
 *
 * Comments and prose are ignored: a workflow comment that mentions
 * `bun run build`, or a TS comment that explains why not to use it, is not a
 * command. `bun run env:build --no-slot` and the guarded workspace script
 * (`bun run --filter @studiq/web build`) pass.
 *
 * Usage: `bun scripts/check-build-entrypoints.ts [root]`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Forbidden {
  pattern: RegExp;
  why: string;
}

const FORBIDDEN: readonly Forbidden[] = [
  { pattern: /\bnext build\b/, why: '`next build` never runs the prebuild guard' },
  {
    pattern: /\bbun run build\b(?![\w:-])/,
    why: 'a bare `bun run build` has no build grant to consume',
  },
];

interface Violation {
  file: string;
  line: number;
  command: string;
  why: string;
}

/** A `#` at line start or after whitespace starts a shell/YAML comment. */
function stripShellComment(line: string): string {
  const match = /(^|\s)#/.exec(line);
  return match ? line.slice(0, match.index) : line;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** `run:` steps of a workflow, as `{ line, command }` pairs. */
function workflowCommands(text: string): Array<{ line: number; command: string }> {
  const lines = text.split('\n');
  const commands: Array<{ line: number; command: string }> = [];
  let blockIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (blockIndent !== null) {
      const blank = line.trim() === '';
      if (!blank && indentOf(line) <= blockIndent) blockIndent = null;
      else {
        const command = stripShellComment(line).trim();
        if (command !== '') commands.push({ line: index + 1, command });
        continue;
      }
    }
    const match = /^(\s*)(?:-\s+)?run:\s*(\|[-+]?|>[-+]?)?\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, indent = '', block, rest = ''] = match;
    if (block !== undefined) {
      blockIndent = indent.length;
      continue;
    }
    const command = stripShellComment(rest).trim();
    if (command !== '') commands.push({ line: index + 1, command });
  }
  return commands;
}

/**
 * Strip TS/JS comments without touching string contents.
 *
 * A naive `//` strip would mangle `'http://localhost:3000'`, and a naive
 * `/* *\/` strip would shift every later line number; both matter here because
 * the report cites a line.
 */
function stripTsComments(text: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;
  while (index < text.length) {
    const char = text[index] as string;
    const next = text[index + 1];
    if (quote !== null) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      const start = index;
      while (index < text.length && text[index] !== '\n') index += 1;
      out += ' '.repeat(index - start);
      continue;
    }
    if (char === '/' && next === '*') {
      const start = index;
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index = Math.min(index + 2, text.length);
      out += text.slice(start, index).replace(/[^\n]/g, ' ');
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Every `command:` string literal in a Playwright config, with its line. */
function playwrightCommands(text: string): Array<{ line: number; command: string }> {
  const source = stripTsComments(text);
  const commands: Array<{ line: number; command: string }> = [];
  for (const match of source.matchAll(/\bcommand:\s*/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const quote = source[start];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;
    let value = '';
    let index = start + 1;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === '\\') {
        value += source[index + 1] ?? '';
        index += 2;
        continue;
      }
      value += source[index];
      index += 1;
    }
    const line = source.slice(0, start).split('\n').length;
    commands.push({ line, command: value });
  }
  return commands;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readdirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function workflowFiles(root: string): string[] {
  const dir = join(root, '.github', 'workflows');
  return readdirOrEmpty(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => join(dir, name))
    .filter(isFile);
}

/** Root `playwright.config.ts` plus any `playwright*.config.ts` under `__tests__`. */
function playwrightFiles(root: string): string[] {
  const files = [join(root, 'playwright.config.ts')].filter(isFile);
  const walk = (dir: string): void => {
    for (const name of readdirOrEmpty(dir)) {
      const path = join(dir, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (name.startsWith('playwright') && name.endsWith('.config.ts')) files.push(path);
    }
  };
  walk(join(root, '__tests__'));
  return [...new Set(files)];
}

function check(
  file: string,
  commands: Array<{ line: number; command: string }>,
  violations: Violation[],
): void {
  for (const { line, command } of commands) {
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(command)) violations.push({ file, line, command, why });
    }
  }
}

const root = process.argv[2] ? resolve(process.argv[2]) : REPO_ROOT;
const violations: Violation[] = [];
let scanned = 0;

for (const file of workflowFiles(root)) {
  scanned += 1;
  check(file, workflowCommands(readFileSync(file, 'utf8')), violations);
}
for (const file of playwrightFiles(root)) {
  scanned += 1;
  check(file, playwrightCommands(readFileSync(file, 'utf8')), violations);
}

if (scanned === 0) {
  console.error(`\n  x no workflow or Playwright config found under ${root}.\n`);
  process.exit(1);
}

if (violations.length > 0) {
  console.error(
    `\n  x ${violations.length} build entrypoint(s) bypass the prebuild guard (ADR-0014, decision 6).\n` +
      '    Use `bun run env:build --no-slot` in CI and Playwright; `bun run env:build` everywhere else.\n',
  );
  for (const violation of violations.sort((left, right) => left.file.localeCompare(right.file))) {
    console.error(`  ${relative(root, violation.file)}:${violation.line}  ${violation.command}`);
    console.error(`    ${violation.why}`);
  }
  console.error('');
  process.exit(1);
}

console.log('✓ build entrypoints go through env:build — no unguarded next build.');
