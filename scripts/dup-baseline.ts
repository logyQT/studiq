#!/usr/bin/env bun
/**
 * Duplication gate: new clones of the working tree against a base commit.
 *
 * Why not `jscpd --baseline-from-ref`. Its identity is the 16-hex
 * `snippet_pair_hash` of the *pair* of snippets jscpd reported
 * (`cpd-reporter/src/baseline.rs`), and jscpd picks that pair among the files
 * sharing a block by detection order. Editing any one of them re-pairs the
 * block with another neighbour, which the base ref has never seen. On PR #1398
 * two rewritten route files produced **9** "new" clones, of which only 1 was
 * duplication the change introduced.
 *
 * This gate identifies a clone by its block (whitespace- and
 * comment-insensitive) and the files holding it, never by the reported pair or
 * a line number. The rule is above `newClones`; it stays a
 * gate in both directions, since a copy of any existing route is new and a
 * re-pairing of files that already shared the block is not.
 *
 * Both trees are scanned by jscpd in JSON mode with the scanned tree's own
 * `.jscpd.json`; the base ref is checked out with `git worktree`, so its scan
 * takes the same paths, `.gitignore` and format filters as the checkout.
 *
 * Usage:
 *   bun scripts/dup-baseline.ts             # vs origin/main
 *   bun scripts/dup-baseline.ts --ref HEAD  # vs HEAD (the pre-commit hook)
 *   bun scripts/dup-baseline.ts --json      # machine output
 *
 * Exit: 0 no new clones, 1 at least one new clone, 2 bad usage or a scan that
 * could not run.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CloneLocation {
  name: string;
  start: number;
  end: number;
}

interface RawReport {
  duplicates: RawClone[];
}

/** A clone as the JSON report carries it. */
interface RawClone {
  firstFile: CloneLocation;
  secondFile: CloneLocation;
  fragment: string;
  tokens: number;
  lines: number;
}

/** A clone reduced to what the gate compares: its files and its content. */
interface Clone {
  /** The two file names, sorted: jscpd reports a pair in either order. */
  pair: [string, string];
  /** Both sides of an exact clone are this text. */
  block: string;
  first: CloneLocation;
  second: CloneLocation;
  tokens: number;
  lines: number;
}

export interface DupBaselineResult {
  ref: string;
  /** Clones in the working tree, and the ones the base ref has of the same pairs. */
  clones: number;
  baseClones: number;
  newClones: Array<{
    first: string;
    second: string;
    lines: number;
    tokens: number;
  }>;
}

/** Exit 2: the comparison could not be made, so it proves nothing either way. */
class GateError extends Error {}

const CONFIG = '.jscpd.json';
// Resolved from this file, not the process cwd: the gate runs from a fixture
// repository in tests and from any directory in a hook.
const JSCPD = fileURLToPath(new URL('./../node_modules/.bin/jscpd', import.meta.url));
// In the scanned scope and forks jscpd, so it repeats the spawn-and-read-report
// shape of the gate scripts beside it. Those copies are the gate describing
// itself, not the change under review.
const SELF = 'scripts/dup-baseline.ts';

function isSelf(clone: RawClone): boolean {
  // Named from the repo root or from the `scripts` scan root.
  const named = (name: string) => name === SELF || name === SELF.replace(/^scripts\//, '');
  return named(clone.firstFile.name) || named(clone.secondFile.name);
}

/**
 * The content a clone is recognised by: line-trimmed and uncommented, with runs
 * of whitespace collapsed. Blocks differing only in indentation, line wrapping
 * of the same tokens or a comment are the same block — the token stream is what
 * a clone is.
 */
export function normaliseBlock(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .join(' ');
}

function toClones(clones: RawClone[]): Clone[] {
  return clones.map((raw) => {
    const [rawFirst, rawSecond] = [raw.firstFile.name, raw.secondFile.name];
    const swapped = rawFirst > rawSecond;
    const block = normaliseBlock(raw.fragment);
    return {
      pair: swapped ? [rawSecond, rawFirst] : [rawFirst, rawSecond],
      block,
      first: raw.firstFile,
      second: raw.secondFile,
      tokens: raw.tokens,
      lines: raw.lines,
    };
  });
}

/** Deliberately not keyed by the file pair: jscpd's pairing is an artifact. */
function blockKey(block: string): string {
  return JSON.stringify(block);
}

/** What the gate compares against, and how it names files. */
export interface Comparison {
  /** Repo-relative paths this branch changed against the base ref. */
  edited: Set<string>;
  /** A clone's file name as a repo-relative path (jscpd names it per scan root). */
  resolve: (name: string) => string;
}

/**
 * The clones of `current` the base ref does not know, under `comparison`.
 *
 * What a clone *is*, for this gate: its **block** (normalised text) and the
 * **two files** that block appears in. Line numbers are deliberately not part
 * of it: they move whenever anything around them changes length.
 *
 * **A clone is new** when both of these hold:
 *
 * 1. **A file of the pair changed.** A pair of two untouched files is identical
 *    in both trees, so a clone reported for it was re-cut by an edit elsewhere.
 * 2. **The base did not already hold that block in both of those files.** If it
 *    did, the content was duplicated between them before this tree existed.
 *
 * Why per file rather than per file pair: jscpd reports a block shared by N
 * files as one clone naming two of them, and which two depends on the order
 * detection meets them in — so editing any file that shares a block changes the
 * pairs reported without changing the duplication. On PR #1398 the same 53-token
 * block of `flashcards/[id]` paired with `groups/[id]` in the base and with
 * `invites/[id]` here, every named file unchanged. Indexing the block by the
 * files holding it absorbs that. A copy is not absorbed — its new home never
 * held the block — so a copy of a plain or an already-duplicated file is new.
 */
export function newClones(current: Clone[], base: Clone[], comparison: Comparison): Clone[] {
  const { resolve } = comparison;
  const edited = (pair: [string, string]) =>
    pair.some((name) => comparison.edited.has(resolve(name)));

  /** Every file the base held each block in. */
  const holders = new Map<string, Set<string>>();
  for (const clone of base) {
    const key = blockKey(clone.block);
    const files = holders.get(key) ?? new Set<string>();
    for (const name of clone.pair) files.add(resolve(name));
    holders.set(key, files);
  }

  return current.filter((clone) => {
    if (!edited(clone.pair)) return false;
    const known = holders.get(blockKey(clone.block));
    if (known === undefined) return true;
    return !clone.pair.every((name) => known.has(resolve(name)));
  });
}

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new GateError(
      `git ${args.join(' ')}: ${result.stderr.trim() || `exit ${result.status}`}`,
    );
  }
  return result.stdout;
}

function repoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

/** The directories a scan starts at, as `.jscpd.json` names them. */
function scanRoots(root: string): string[] {
  const config = JSON.parse(readFileSync(join(root, CONFIG), 'utf8')) as { path?: string[] };
  return (config.path ?? ['.']).map((path) => path.replace(/^\.\//, '').replace(/\/$/, ''));
}

/**
 * A clone's file name as a path from the repository root: jscpd names a file
 * relative to the scan root it was found under (`lib/x.ts` for
 * `apps/web/src/lib/x.ts`) and does not say which, while git speaks
 * repo-relative paths. Roots are tried longest first against the files that
 * exist, so a nested root wins over its parent.
 */
function repoPath(name: string, roots: string[], root: string): string {
  const ordered = [...roots].sort((a, b) => b.length - a.length);
  for (const scanRoot of ordered) {
    if (scanRoot === '.' || scanRoot === '') return name;
    if (existsSync(join(root, scanRoot, name))) return `${scanRoot}/${name}`;
  }
  return name;
}

/**
 * Every path the change under review touches, relative to where the branch left
 * `ref`: the merge-base's diff against the working tree covers the branch's
 * commits, the staged and the unstaged edits in one range, and
 * `git ls-files --others` adds everything untracked, which a scan sees and a
 * commit never will.
 *
 * The base is the merge-base, not `ref` itself: on a branch, `diff ref` already
 * contains the branch's own commits, so a file added in one of them would read
 * as "changed in the working tree" and the hook would blame it. The base ref's
 * *tree* is still what clones are compared against — the scans use `ref`.
 */
function changedPaths(root: string, ref: string): Set<string> {
  const mergeBase = git(['merge-base', ref, 'HEAD'], root).trim();
  const diffed = git(['diff', '--name-only', '-z', mergeBase, '--'], root).split('\0');
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], root).split('\0');
  return new Set([...diffed, ...untracked].filter((path) => path.length > 0));
}

function scan(cwd: string, output: string): RawReport {
  // The config is read from the tree being scanned, never from `cwd`'s: the
  // base ref's `.jscpd.json` is part of the base ref. Taking the checkout's
  // would let a config change — or a relative path that resolves differently
  // in a nested worktree — apply one rule to two trees.
  const config = join(cwd, CONFIG);
  if (!existsSync(config)) {
    throw new GateError(
      `no ${CONFIG} in ${cwd}; the duplication gate needs the scanned tree's config`,
    );
  }
  const result = spawnSync(
    JSCPD,
    ['-c', config, '-r', 'json', '-o', output, '--report-name', 'report', '--silent'],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new GateError(
      `jscpd failed in ${cwd}: ${result.stderr.trim() || `exit ${result.status}`}`,
    );
  }
  const report = readReport(output);
  return { ...report, duplicates: report.duplicates.filter((clone) => !isSelf(clone)) };
}

function readReport(output: string): RawReport {
  return JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as RawReport;
}

function withWorktree<T>(root: string, ref: string, use: (dir: string) => T): T {
  // A detached checkout of `ref` under the temp dir, removed on every exit
  // path — including a throw. `core.hooksPath` is neutralised: the checkout is
  // the gate's, and a repository hook has no business running on it.
  const dir = mkdtempSync(join(tmpdir(), 'dup-baseline-'));
  git(['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--quiet', dir, ref], root);

  try {
    return use(realpathSync(dir));
  } finally {
    const removed = spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: root });
    if (removed.status !== 0) rmSync(dir, { recursive: true, force: true });
  }
}

export function compare(ref: string, cwd: string = process.cwd()): DupBaselineResult {
  const root = repoRoot(cwd);
  const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd: root,
  });
  if (probe.status !== 0) {
    throw new GateError(`base ref '${ref}' not found; fetch it first (e.g. git fetch origin main)`);
  }

  const output = mkdtempSync(join(tmpdir(), 'dup-baseline-report-'));
  try {
    const currentReport = scan(root, join(output, 'current'));
    const baseReport = withWorktree(root, ref, (dir) => scan(dir, join(output, 'base')));

    const current = toClones(currentReport.duplicates);
    const base = toClones(baseReport.duplicates);
    const changed = changedPaths(root, ref);
    const roots = scanRoots(root);
    const resolved = new Map<string, string>();
    const resolve = (name: string) => {
      const known = resolved.get(name);
      if (known !== undefined) return known;
      const path = repoPath(name, roots, root);
      resolved.set(name, path);
      return path;
    };
    const fresh = newClones(current, base, { edited: changed, resolve });
    return {
      ref,
      clones: current.length,
      baseClones: base.length,
      newClones: fresh.map((clone) => ({
        first: `${clone.first.name}:${clone.first.start}`,
        second: `${clone.second.name}:${clone.second.start}`,
        lines: clone.lines,
        tokens: clone.tokens,
      })),
    };
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const refIndex = argv.indexOf('--ref');
  const ref = refIndex === -1 ? 'origin/main' : argv[refIndex + 1];
  const unknown = argv.filter(
    (arg, index) => arg !== '--json' && arg !== '--ref' && index !== refIndex + 1,
  );

  if (ref === undefined || ref.startsWith('--') || unknown.length > 0) {
    console.error(`dup-baseline: usage: dup-baseline.ts [--ref <git-ref>] [--json]`);
    process.exitCode = 2;
    return;
  }

  let result: DupBaselineResult;
  try {
    result = compare(ref);
  } catch (error) {
    console.error(`dup-baseline: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.newClones.length === 0) {
    console.log(`Dup vs ${ref}: no new clones (${result.clones} clone(s) in the tree)`);
  } else {
    console.error(
      `${result.newClones.length} new clone(s) not in ${ref} (${result.clones} in the tree):`,
    );
    for (const clone of result.newClones) {
      console.error(
        `  NEW ${clone.first} <-> ${clone.second} (${clone.lines} lines, ${clone.tokens} tokens)`,
      );
    }
    console.error('Extract the shared code, or make the copy deliberately different.');
  }

  if (result.newClones.length > 0) process.exitCode = 1;
}

// Importable for tests without running the CLI.
if (import.meta.main) {
  main();
}
