#!/usr/bin/env bun
/**
 * Flaky-test ledger from Playwright JSON reports.
 *
 * A test that fails and then passes on retry is a green leg, so nothing in CI
 * recorded it: the `line` reporter printed a count into a job log, and the
 * artifacts were uploaded only `if: failure()`. CI now writes the machine report
 * (`--reporter=line,json` + `PLAYWRIGHT_JSON_OUTPUT_NAME`) and uploads
 * `test-results/` whether the leg passes or fails — `trace: 'on-first-retry'`
 * means a flaky attempt leaves a trace there — so this reads those reports and
 * ranks what actually wobbles, across many runs at once.
 *
 * Written for another agent to run, so the exit code is the verdict and stdout
 * is data only:
 *
 *   0  no flakes in anything it could read
 *   1  at least one flaky or still-failing test (details on stdout)
 *   2  bad usage, or `--runs` could not list/download runs
 *   3  no Playwright report found — reporting "clean" there would be a lie
 *
 * Usage:
 *   bun scripts/flaky-report.ts                      # this checkout's test-results/
 *   bun scripts/flaky-report.ts -- --dir path/to/x    # any directory of reports
 *   bun scripts/flaky-report.ts -- --runs 20          # last 20 verify runs, via gh
 *   bun scripts/flaky-report.ts -- --runs 20 --text   # same, as a table
 *   bun scripts/flaky-report.ts -- --summary          # GitHub step summary (CI)
 *
 * `--dir` and `--runs` combine; with neither, `test-results` is read. `--runs`
 * caches downloads in `.tmp/flaky/<runId>/`, so a repeat call re-reads instead of
 * re-downloading. Progress goes to stderr: stdout stays parseable.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, join } from 'node:path';

type Json = Record<string, unknown>;

/** One test as it appears in one report. */
interface ObservedTest {
  /** Repo-relative spec path, resolved through the report's `config.rootDir`. */
  file: string;
  title: string;
  project: string;
  /** Playwright's per-test status: `expected`, `unexpected`, `flaky`, `skipped`. */
  status: string;
  /** Duration of the slowest failed attempt, in ms — the ledger's triage signal. */
  slowestFailureMs?: number;
  /** First line of the first failure, so a name is not the only clue. */
  error?: string;
}

/** One test across every report that ran it. */
export interface FlakeEntry {
  file: string;
  title: string;
  project: string;
  /** Reports in which the test ran (skipped reports are not counted). */
  seenIn: number;
  /** Reports where a retry rescued it. */
  flaky: number;
  /** Reports where it was still red after every retry. */
  failed: number;
  slowestFailureMs?: number;
  lastError?: string;
  /** Command that replays just this test without the retry budget hiding it. */
  reproduce: string;
}

export type Verdict = 'clean' | 'flaky' | 'failing' | 'no-data';

interface Report {
  tests: ObservedTest[];
}

const SCHEMA = 1;
const SUMMARY_ROW_LIMIT = 10;
const ERROR_LIMIT = 140;

class UsageError extends Error {}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// Playwright prefixes failure text with ANSI colour codes; a ledger line with
// escape sequences in it is unreadable in a summary table and in an agent's log.
const ANSI = /\u001B\[[\d;]*m/g;

function firstErrorLine(errors: unknown): string | undefined {
  if (!Array.isArray(errors)) return undefined;
  for (const error of errors) {
    if (!isRecord(error)) continue;
    const message = asString(error.message);
    if (message === undefined) continue;
    for (const line of message.replace(ANSI, '').split('\n')) {
      const trimmed = line.trim();
      if (trimmed !== '') return trimmed.slice(0, ERROR_LIMIT);
    }
  }
  return undefined;
}

function walkSuite(
  suite: unknown,
  rootDir: string,
  inheritedFile: string | undefined,
  out: ObservedTest[],
): void {
  if (!isRecord(suite)) return;
  const file = asString(suite.file) ?? inheritedFile;

  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      if (!isRecord(spec)) continue;
      const title = asString(spec.title) ?? '(untitled)';
      // Playwright writes `file` on both the suite and the spec; preferring the
      // spec keeps a report whose suite omits it from losing the path.
      const specFile = asString(spec.file) ?? file;
      if (!Array.isArray(spec.tests)) continue;
      for (const test of spec.tests) {
        if (!isRecord(test)) continue;
        const results = Array.isArray(test.results) ? test.results.filter(isRecord) : [];
        const failures = results.filter(
          (result) => result.status !== 'passed' && result.status !== 'skipped',
        );
        const slowest = failures
          .map((result) => (typeof result.duration === 'number' ? result.duration : 0))
          .sort((a, b) => b - a)[0];

        out.push({
          file: displayPath(specFile, rootDir),
          title,
          project: asString(test.projectName) ?? NO_PROJECT,
          status: asString(test.status) ?? 'unknown',
          slowestFailureMs: slowest === undefined ? undefined : Math.round(slowest),
          error: failures.map((result) => firstErrorLine(result.errors)).find(Boolean),
        });
      }
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const child of suite.suites) walkSuite(child, rootDir, file, out);
  }
}

// `file` is relative to the report's `rootDir`, which is the runner's absolute
// checkout path in CI. Normalising through it keeps the ledger's identity stable
// across machines, and falls back to the raw value when it does not resolve
// inside this checkout (a report copied from elsewhere).
function displayPath(file: string | undefined, rootDir: string): string {
  if (file === undefined) return '(unknown spec)';
  if (rootDir === '') return file;
  const absolute = resolve(rootDir, file);
  const local = relative(process.cwd(), absolute);
  return local.startsWith('..') ? file : local;
}

/** Parse one Playwright JSON report. Anything that is not one yields nothing. */
export function parseReport(raw: unknown): ObservedTest[] {
  if (!isRecord(raw) || !Array.isArray(raw.suites)) return [];
  const config = isRecord(raw.config) ? raw.config : {};
  const rootDir = asString(config.rootDir) ?? '';
  const tests: ObservedTest[] = [];
  for (const suite of raw.suites) walkSuite(suite, rootDir, undefined, tests);
  return tests;
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(path);
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * Every Playwright report under `dir`, recursively. Shape, not filename, decides:
 * `test-results/<test>/` also holds the JSON a spec attached, and parsing one of
 * those as a report would invent tests.
 */
export function readReports(dir: string): Report[] {
  const reports: Report[] = [];
  for (const path of jsonFiles(dir)) {
    let tests: ObservedTest[];
    try {
      tests = parseReport(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      continue;
    }
    if (tests.length > 0) reports.push({ tests });
  }
  return reports;
}

function escapeGrep(title: string): string {
  return title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Single quotes, because the title is a grep pattern: inside double quotes a
// backslash survives only in front of `$ \ ` "`, so an escaped `\(` would be
// mangled by the shell. Only `'` needs escaping, and the command is meant to be
// copied verbatim.
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// No project list in a runner's config means there is no `--project` to name;
// `(default)` is a label for the ledger, not a Playwright project.
const NO_PROJECT = '(default)';

// The QA cases live behind their own config (different `testDir`, one tenant per
// case), so a replay that used the root config would not find the spec at all.
const QA_CONFIG = '__tests__/qa/playwright.qa.config.ts';

function reproduceCommand(test: ObservedTest): string {
  const args = ['bunx playwright test'];
  if (test.file.startsWith('__tests__/qa/')) args.push(`-c ${QA_CONFIG}`);
  args.push(shellQuote(test.file));
  if (test.project !== NO_PROJECT) args.push(`--project=${test.project}`);
  // `--retries=0` on purpose: the ledger already knows the test flakes, so the
  // replay is for reproducing the failure, not for hiding it behind a retry.
  args.push(`-g ${shellQuote(escapeGrep(test.title))}`, '--repeat-each=5 --retries=0');
  return args.join(' ');
}

/**
 * Fold every observation into one entry per test. Skipped observations do not
 * count towards `seenIn`: a slipped-through skip is not a run.
 */
export function aggregate(reports: Report[]): FlakeEntry[] {
  const entries = new Map<string, FlakeEntry>();

  for (const report of reports) {
    for (const test of report.tests) {
      if (test.status === 'skipped') continue;
      const key = `${test.file}\u0000${test.title}\u0000${test.project}`;
      const entry = entries.get(key) ?? {
        file: test.file,
        title: test.title,
        project: test.project,
        seenIn: 0,
        flaky: 0,
        failed: 0,
        reproduce: reproduceCommand(test),
      };

      entry.seenIn += 1;
      if (test.status === 'flaky') entry.flaky += 1;
      if (test.status === 'unexpected') entry.failed += 1;
      if (
        test.slowestFailureMs !== undefined &&
        (entry.slowestFailureMs === undefined || test.slowestFailureMs > entry.slowestFailureMs)
      ) {
        entry.slowestFailureMs = test.slowestFailureMs;
      }
      if (test.error !== undefined) entry.lastError = test.error;

      entries.set(key, entry);
    }
  }

  return [...entries.values()]
    .filter((entry) => entry.flaky > 0 || entry.failed > 0)
    .sort(
      (a, b) =>
        b.flaky - a.flaky ||
        b.failed - a.failed ||
        a.file.localeCompare(b.file) ||
        a.title.localeCompare(b.title) ||
        a.project.localeCompare(b.project),
    );
}

interface RunsResult {
  requested: number;
  collected: number;
  failed: number[];
}

function gh(args: string[]): string {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new UsageError('`--runs` needs the GitHub CLI on PATH (`gh auth status`)');
  }
  if (result.status !== 0) {
    throw new UsageError(
      `gh ${args.join(' ')} failed: ${result.stderr.trim().split('\n')[0] ?? 'no output'}`,
    );
  }
  return result.stdout;
}

/** Download the last `limit` verify runs' artifacts into `.tmp/flaky/<runId>/`. */
function fetchRuns(
  limit: number,
  branch: string | undefined,
): { dirs: string[]; runs: RunsResult } {
  const args = [
    'run',
    'list',
    '--workflow',
    'verify.yml',
    '--limit',
    String(limit),
    '--json',
    'databaseId,conclusion',
  ];
  if (branch !== undefined) args.push('--branch', branch);

  const parsed: unknown = JSON.parse(gh(args));
  if (!Array.isArray(parsed)) throw new UsageError('gh run list returned no JSON array');

  const root = join(process.cwd(), '.tmp', 'flaky');
  mkdirSync(root, { recursive: true });

  const dirs: string[] = [];
  const failed: number[] = [];
  let requested = 0;

  for (const run of parsed) {
    if (!isRecord(run) || typeof run.databaseId !== 'number') continue;
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') continue;
    requested += 1;

    const dir = join(root, String(run.databaseId));
    if (jsonFiles(dir).length > 0) {
      dirs.push(dir);
      continue;
    }
    // A run whose e2e/QA legs were scoped out has no artifacts at all; that is a
    // miss in the ledger's coverage, not a reason to abort the report.
    const download = spawnSync('gh', ['run', 'download', String(run.databaseId), '--dir', dir], {
      encoding: 'utf8',
    });
    if (download.status === 0 && jsonFiles(dir).length > 0) dirs.push(dir);
    else failed.push(run.databaseId);
  }

  return { dirs, runs: { requested, collected: dirs.length, failed } };
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  for (const [index, arg] of process.argv.entries()) {
    if (arg !== name) continue;
    const value = process.argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${name} requires a value`);
    }
    values.push(value);
  }
  return values;
}

function option(name: string): string | undefined {
  return optionValues(name)[0];
}

function parseCount(raw: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) <= 0)
    throw new UsageError('--runs must be a positive integer');
  return Number(raw);
}

function verdictOf(entries: FlakeEntry[]): Verdict {
  if (entries.some((entry) => entry.failed > 0)) return 'failing';
  if (entries.length > 0) return 'flaky';
  return 'clean';
}

function renderTable(entries: FlakeEntry[]): string {
  const width = Math.max(...entries.map((entry) => `${entry.file} › ${entry.title}`.length), 7);
  return entries
    .map((entry) => {
      const name = `${entry.file} › ${entry.title}`.padEnd(width);
      const counts = `${entry.flaky} flaky / ${entry.failed} failed in ${entry.seenIn}`;
      const timing = entry.slowestFailureMs === undefined ? '' : `  ${entry.slowestFailureMs} ms`;
      const error = entry.lastError === undefined ? '' : `\n      ${entry.lastError}`;
      return `  ${entry.project.padEnd(8)} ${name}  ${counts}${timing}${error}`;
    })
    .join('\n');
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function renderMarkdown(
  entries: FlakeEntry[],
  runs: RunsResult | undefined,
  parsed: number,
): string {
  const shown = entries.slice(0, SUMMARY_ROW_LIMIT);
  const lines = [
    `### Flaky tests (${entries.length} in ${parsed} report${parsed === 1 ? '' : 's'})`,
    '',
    '| test | browser | flaky | failed | slowest failure | last error |',
    '| --- | --- | --- | --- | --- | --- |',
    ...shown.map(
      (entry) =>
        `| \`${escapeCell(entry.file)}\` › ${escapeCell(entry.title)} | ${entry.project} | ${entry.flaky}/${entry.seenIn} | ${entry.failed} | ${entry.slowestFailureMs === undefined ? '—' : `${entry.slowestFailureMs} ms`} | ${entry.lastError === undefined ? '—' : escapeCell(entry.lastError)} |`,
    ),
  ];
  if (entries.length > shown.length) {
    lines.push(
      '',
      `…and ${entries.length - shown.length} more; \`bun scripts/flaky-report.ts\` lists all.`,
    );
  }
  if (runs !== undefined && runs.failed.length > 0) {
    lines.push(
      '',
      `Runs not collected: ${runs.failed.join(', ')} — the counts above only cover ${runs.collected} of ${runs.requested}.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function writeSummary(markdown: string): void {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (target === undefined || target === '') {
    process.stdout.write(markdown);
    return;
  }
  appendFileSync(target, markdown);
}

function main(): number {
  const summary = process.argv.includes('--summary');
  const text = process.argv.includes('--text');
  const roots = optionValues('--dir');

  let runs: RunsResult | undefined;
  const runLimit = option('--runs');
  if (runLimit !== undefined) {
    const fetched = fetchRuns(parseCount(runLimit), option('--branch'));
    runs = fetched.runs;
    roots.push(...fetched.dirs);
    if (runs.failed.length > 0) {
      process.stderr.write(`flaky-report: ${runs.failed.length} run(s) had no artifacts to read\n`);
    }
  }

  const scanDirs = roots.length > 0 ? roots : ['test-results'];
  const reports = scanDirs.flatMap((dir) => readReports(dir));
  const entries = aggregate(reports);

  if (reports.length === 0) {
    const message = `flaky-report: no Playwright JSON report under ${scanDirs.join(', ')} — nothing was checked`;
    process.stderr.write(`${message}\n`);
    // `--summary` is a display surface on a CI leg that may already be red for an
    // unrelated reason; the strict "no data" verdict belongs to the query modes.
    if (summary) {
      writeSummary(`> ${message}\n`);
      return 0;
    }
    return 3;
  }

  if (summary) {
    // A reporting surface never fails a green leg on a flake: the ledger's job is
    // to make it visible, and the exit codes below belong to the query modes.
    if (entries.length > 0) writeSummary(renderMarkdown(entries, runs, reports.length));
    return 0;
  }

  const verdict = verdictOf(entries);

  if (text) {
    process.stdout.write(
      `flaky-report: ${verdict} — ${entries.length} problem test(s) in ${reports.length} report(s)\n`,
    );
    if (entries.length > 0) process.stdout.write(`${renderTable(entries)}\n`);
  } else {
    const payload = {
      schema: SCHEMA,
      verdict,
      reports: { parsed: reports.length, roots: scanDirs },
      ...(runs === undefined ? {} : { runs }),
      entries,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }

  return verdict === 'clean' ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(
      `flaky-report: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
