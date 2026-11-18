/**
 * Mutation gate — break one thing on purpose, run one named test, revert.
 *
 * The method lives in `.agents/skills/mutation-gate/SKILL.md`; this file is the
 * part a human should not be trusted to redo by hand. Two harnesses in the
 * ADR-0014 arc classified `vitest run -t "<title>"` with a title that matched
 * nothing as "mutant survived": that run exits 0 and reports the test as
 * *skipped*, so the harness was decoration. This one classifies on
 * `numPassedTests + numFailedTests` and reports zero executed as `ERROR`.
 *
 * The proof is only worth as much as the revert, so the tool refuses to start
 * on a dirty tree, refuses to mutate a test, and fails loudly if the tree is
 * dirty after `git checkout --`.
 *
 * Usage:
 *   bun scripts/mutate.ts --file <path> --find <exact text> --replace <text> \
 *                         --test <test file> --name "<exact test title>" [--all] [--json] [--keep]
 *   bun scripts/mutate.ts --spec <mutations.json> [--json]
 *
 * `--spec` reads a JSON array of `{ "file", "find", "replace", "test", "name", "all"? }`
 * — one PR's mutation table, reproducible from the body. The spec file must be
 * committed or outside the worktree: a dirty tree is refused, by design.
 *
 * `--json` writes one NDJSON line per mutation on stdout and nothing else:
 *   {"file":"…","find":"…","test":"…","title":"…","outcome":"KILLED|SURVIVED|ERROR","executed":<n>,"detail":"…"}
 *
 * Exit: 0 = no ERROR, 1 = at least one ERROR, 2 = usage/precondition failure.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const CWD = process.cwd();
/** One hung mutation must not hang a review; a test-level timeout usually fires first. */
const RUN_TIMEOUT_MS = 180_000;
const DETAIL_LIMIT = 240;

type Outcome = 'KILLED' | 'SURVIVED' | 'ERROR';

interface Mutation {
  file: string;
  find: string;
  replace: string;
  test: string;
  name: string;
  all: boolean;
}

interface Report {
  file: string;
  find: string;
  test: string;
  title: string;
  outcome: Outcome;
  executed: number;
  detail: string;
}

/** The subset of vitest's JSON reporter this tool trusts. */
interface VitestReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: Array<{
    message: string;
    assertionResults: Array<{ fullName: string; status: string; failureMessages: string[] }>;
  }>;
}

interface RunResult {
  report: VitestReport | null;
  executed: number;
  failed: number;
  skipped: number;
  total: number;
  /** First line of the first failure, so a kill can be checked for its reason. */
  failure: string | null;
  /** Why there is no usable report, when that is the case. */
  note: string;
}

const flags = parseArgs(process.argv.slice(2));
const json = flags.boolean.has('--json');
const keep = flags.boolean.has('--keep');

/** Progress goes to stdout normally, and to stderr in `--json` mode so stdout stays NDJSON. */
function say(line: string): void {
  (json ? process.stderr : process.stdout).write(`${line}\n`);
}

function usage(message: string): never {
  process.stderr.write(`mutate: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): { values: Map<string, string>; boolean: Set<string> } {
  const values = new Map<string, string>();
  const boolean = new Set<string>();
  const takesValue = new Set(['--file', '--find', '--replace', '--test', '--name', '--spec']);
  const switches = new Set(['--json', '--keep', '--all']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (switches.has(flag)) {
      if (eq > 0) usage(`${flag} does not take a value`);
      boolean.add(flag);
      continue;
    }
    if (!takesValue.has(flag)) usage(`unknown argument '${arg}'`);
    if (eq > 0) {
      values.set(flag, arg.slice(eq + 1));
      continue;
    }
    // An empty value is legal for --replace (delete the snippet); a missing one is not.
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) usage(`${flag} needs a value`);
    values.set(flag, next);
    index += 1;
  }
  return { values, boolean };
}

function required(name: string): string {
  const value = flags.values.get(name);
  if (value === undefined || value === '') usage(`${name} is required`);
  return value;
}

function git(args: string[]): { code: number; out: string; err: string } {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd: CWD,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: result.exitCode ?? 1,
    out: result.stdout.toString().trim(),
    err: result.stderr.toString().trim(),
  };
}

/** `git status --porcelain`, one entry per line, or the reason git cannot answer. */
function status(): string {
  const result = git(['status', '--porcelain']);
  if (result.code !== 0) usage(`not a git worktree (${result.err || 'git status failed'})`);
  return result.out;
}

function requireClean(stage: string): void {
  const dirty = status();
  if (dirty === '') return;
  usage(
    `the worktree is not clean ${stage} — the method depends on an exact revert.\n${dirty}\n` +
      'Commit, stash or restore these paths, then re-run.',
  );
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function vitestBin(): string {
  let dir = CWD;
  for (;;) {
    const candidate = join(dir, 'node_modules', '.bin', 'vitest');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) usage('cannot find node_modules/.bin/vitest — run `bun install`');
    dir = parent;
  }
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? '';
  return line.length > DETAIL_LIMIT ? `${line.slice(0, DETAIL_LIMIT)}…` : line;
}

function runTest(bin: string, test: string, name: string): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-mutate-'));
  const out = join(dir, 'vitest.json');
  try {
    const result = Bun.spawnSync({
      cmd: [bin, 'run', test, '-t', name, '--reporter=json', `--outputFile=${out}`],
      cwd: CWD,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: RUN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    const empty: RunResult = {
      report: null,
      executed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      failure: null,
      note: '',
    };
    if (!existsSync(out)) {
      const stderr = result.stderr.toString().trim();
      const timedOut = result.exitCode === null;
      return {
        ...empty,
        note: timedOut
          ? `vitest did not finish within ${RUN_TIMEOUT_MS}ms`
          : `vitest wrote no JSON report (exit ${result.exitCode ?? 'signal'})${stderr ? `: ${firstLine(stderr)}` : ''}`,
      };
    }
    let report: VitestReport;
    try {
      report = JSON.parse(readFileSync(out, 'utf8')) as VitestReport;
    } catch {
      return { ...empty, note: 'vitest JSON report is unreadable (truncated run)' };
    }
    const assertions = report.testResults.flatMap((file) => file.assertionResults);
    const failure = assertions
      .flatMap((assertion) => assertion.failureMessages)
      .find((message) => message.trim() !== '');
    const suiteMessage = report.testResults
      .map((file) => file.message)
      .find((message) => message.trim() !== '');
    return {
      report,
      // Not numTotalTests: a `-t` filter that matches nothing still counts the
      // test as total and reports it skipped.
      executed: report.numPassedTests + report.numFailedTests,
      failed: report.numFailedTests,
      skipped: report.numPendingTests + report.numTodoTests,
      total: report.numTotalTests,
      failure: failure ? firstLine(failure) : suiteMessage ? firstLine(suiteMessage) : null,
      note: '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A baseline that cannot name one passing test makes every outcome meaningless. */
function baselineError(result: RunResult, name: string, test: string): string | null {
  if (!result.report) return result.note || 'vitest produced no report';
  if (result.executed === 0) {
    return `${name ? `no test matched "${name}" in ${test}` : `no test matched in ${test}`} (0 executed, ${result.skipped} skipped)`;
  }
  if (result.executed > 1) {
    return `the name matched ${result.executed} tests in ${test}; pass the exact full title`;
  }
  if (result.failed > 0)
    return `the test fails before the mutation: ${result.failure ?? 'no message'}`;
  return null;
}

function classify(
  result: RunResult,
  name: string,
  test: string,
): { outcome: Outcome; detail: string } {
  if (!result.report) {
    return { outcome: 'ERROR', detail: `${result.note}; an error is never proof` };
  }
  if (result.executed === 0) {
    const reason =
      result.total === 0
        ? `no test matched "${name}" in ${test}: the suite produced no executable test after the mutation`
        : `all ${result.skipped} matched tests were skipped after the mutation`;
    return { outcome: 'ERROR', detail: `${reason}; an error is never proof` };
  }
  if (result.executed > 1) {
    return {
      outcome: 'ERROR',
      detail: `the name matched ${result.executed} tests in ${test}; the kill cannot be attributed`,
    };
  }
  if (result.failed > 0) {
    return { outcome: 'KILLED', detail: result.failure ?? 'the named test failed' };
  }
  return { outcome: 'SURVIVED', detail: 'the named test passed with the mutation applied' };
}

function relativeToCwd(file: string): string {
  const rel = resolve(CWD, file).slice(CWD.length + 1);
  if (rel.startsWith('..')) usage(`'${file}' is outside the worktree; the revert runs here`);
  return rel;
}

/** The mutator proves tests; editing them is the coordinator's job (TRIM), not this tool's. */
function assertNotATest(file: string): void {
  const rel = relativeToCwd(file);
  const isTest = rel.split('/').includes('__tests__') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
  if (isTest) {
    usage(
      `refusing to mutate the test file '${rel}'. This tool breaks production code and reverts it; ` +
        'removing an assertion is a TRIM, owned by whoever reviews the suite.',
    );
  }
}

function mutate(
  bin: string,
  mutation: Mutation,
  original: string,
): { report: Report; reverted: boolean } {
  const rel = relativeToCwd(mutation.file);
  const base = {
    file: rel,
    find: mutation.find,
    test: relativeToCwd(mutation.test),
    title: mutation.name,
  };
  const report = (outcome: Outcome, executed: number, detail: string): Report => ({
    ...base,
    outcome,
    executed,
    detail,
  });
  const failed = (detail: string) => ({ report: report('ERROR', 0, detail), reverted: !keep });

  const occurrences = countOccurrences(original, mutation.find);
  if (occurrences === 0) usage(`--find matched 0 times in ${rel}: nothing was mutated`);
  if (occurrences > 1 && !mutation.all) {
    usage(
      `--find matched ${occurrences} times in ${rel}: pass a larger exact snippet, or --all to mutate every occurrence`,
    );
  }

  // The mutated run can only be read against a green baseline: a test that was
  // already red would "kill" every mutant, and a name that matches nothing
  // would "survive" all of them.
  const before = runTest(bin, base.test, mutation.name);
  const blocker = baselineError(before, mutation.name, base.test);
  if (blocker) return failed(`baseline: ${blocker}; an error is never proof`);

  writeFileSync(mutation.file, original.split(mutation.find).join(mutation.replace));
  let after: RunResult;
  try {
    after = runTest(bin, base.test, mutation.name);
  } finally {
    if (keep) {
      process.stderr.write(
        `mutate: --keep left ${rel} mutated; restore it with git checkout -- ${rel}\n`,
      );
    } else {
      git(['checkout', '--', rel]);
      const leftover = status();
      if (leftover !== '') {
        process.stderr.write(
          `mutate: REVERT FAILED — the worktree is dirty after git checkout -- ${rel}:\n${leftover}\n`,
        );
        return failed(`revert failed, the worktree is dirty: ${firstLine(leftover)}`);
      }
    }
  }

  const { outcome, detail } = classify(after, mutation.name, base.test);
  return { report: report(outcome, after.executed, detail), reverted: !keep };
}

function loadSpec(path: string): Mutation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(CWD, path), 'utf8'));
  } catch (error) {
    usage(
      `cannot read the spec at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    usage('the spec must be a non-empty JSON array of mutations');
  }
  return parsed.map((entry: unknown, index: number) => {
    if (typeof entry !== 'object' || entry === null) usage(`spec[${index}] is not an object`);
    const record = entry as Record<string, unknown>;
    const field = (key: string): string => {
      const value = record[key];
      if (typeof value !== 'string' || value === '')
        usage(`spec[${index}].${key} must be a non-empty string`);
      return value;
    };
    if (record.all !== undefined && typeof record.all !== 'boolean') {
      usage(`spec[${index}].all must be a boolean`);
    }
    return {
      file: field('file'),
      find: field('find'),
      replace: typeof record.replace === 'string' ? record.replace : '',
      test: field('test'),
      name: field('name'),
      all: record.all === true,
    };
  });
}

function main(): void {
  if (keep && flags.values.has('--spec')) {
    usage('--keep cannot be combined with --spec: a kept mutation would poison the next one');
  }
  const spec = flags.values.get('--spec');
  const mutations: Mutation[] = spec
    ? loadSpec(spec)
    : [
        {
          file: required('--file'),
          find: required('--find'),
          replace: flags.values.get('--replace') ?? '',
          test: required('--test'),
          name: required('--name'),
          all: flags.boolean.has('--all'),
        },
      ];

  for (const mutation of mutations) {
    if (mutation.find === mutation.replace)
      usage('--find and --replace are identical: that is not a mutation');
    if (!existsSync(resolve(CWD, mutation.file))) usage(`no such file: ${mutation.file}`);
    if (!existsSync(resolve(CWD, mutation.test))) usage(`no such test file: ${mutation.test}`);
    assertNotATest(mutation.file);
  }

  requireClean('before the first mutation');
  const bin = vitestBin();
  const reports: Report[] = [];

  for (const [index, mutation] of mutations.entries()) {
    const original = readFileSync(resolve(CWD, mutation.file), 'utf8');
    say(`\n[${index + 1}/${mutations.length}] ${relativeToCwd(mutation.file)}`);
    say(`  find:    ${mutation.find.split('\n')[0]}`);
    say(`  replace: ${mutation.replace.split('\n')[0]}`);
    say(`  test:    ${relativeToCwd(mutation.test)}`);
    say(`  title:   ${mutation.name}`);
    const result = mutate(bin, mutation, original);
    const { report } = result;
    reports.push(report);
    if (json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      say(`  outcome: ${report.outcome} (${report.executed} executed) — ${report.detail}`);
      if (result.reverted) say('  revert:  clean');
    }
    if (report.outcome === 'ERROR') break;
  }

  const counts = { KILLED: 0, SURVIVED: 0, ERROR: 0 };
  for (const result of reports) counts[result.outcome] += 1;
  say(
    `\n${reports.length} mutation(s): ${counts.KILLED} KILLED, ${counts.SURVIVED} SURVIVED, ${counts.ERROR} ERROR`,
  );
  if (counts.ERROR > 0) process.exit(1);
}

main();
