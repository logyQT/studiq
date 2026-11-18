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
 * on a dirty tree, refuses to mutate a test, refuses a file git cannot restore
 * (untracked or ignored — no pre-image), and proves each revert with the
 * checkout's exit code *and* a diff, not with `git status` alone (which cannot
 * see an ignored file).
 *
 * A `KILLED` is re-checked: the test is run again without the mutation, and a
 * red re-run is `ERROR` / "flake suspected" — a flake must never read as a
 * proof.
 *
 * Usage:
 *   bun scripts/mutate.ts --file <path> --find <exact text> --replace <text> \
 *                         --test <test file> --name "<exact test title>" [--all] [--json] [--keep]
 *   bun scripts/mutate.ts --spec <mutations.json> [--json]
 *
 * `--spec` reads a JSON array of `{ "file", "find", "replace", "test", "name", "all"? }`
 * — one PR's mutation table, reproducible from the body. The spec file must be
 * committed, git-ignored, or outside the worktree: a dirty tree is refused, by
 * design. A row that comes back `ERROR` does not stop the table (its value is
 * the whole table); a row whose `--find` is malformed does, because the table is
 * wrong.
 *
 * `--json` writes one NDJSON line per mutation on stdout and nothing else:
 *   {"file":"…","find":"…","test":"…","title":"…","outcome":"KILLED|SURVIVED|ERROR","executed":<n>,"detail":"…"}
 *
 * Exit: 0 = no ERROR, 1 = at least one ERROR, 2 = usage/precondition failure.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const CWD = process.cwd();
/** The worktree with symlinks resolved, so a link cannot smuggle a path out. */
const REAL_CWD = realpathSync(CWD);
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

const HELP = `mutate — break one line, run one named test, revert

  bun scripts/mutate.ts --file <path> --find <exact text> --replace <text> \\
                        --test <test file> --name "<exact test title>" [--all] [--json] [--keep]
  bun scripts/mutate.ts --spec <mutations.json> [--json]

  --find must match exactly once in the file, or pass --all.
  The mutated file must be tracked by git: a mutation needs a pre-image to revert.
  After a KILLED the test is re-run unmutated; a red re-run is ERROR (a flake).
  In --spec mode a row that comes back ERROR does not stop the table.
  Exit: 0 = no ERROR, 1 = at least one ERROR, 2 = usage/precondition.
`;

function parseArgs(argv: string[]): { values: Map<string, string>; boolean: Set<string> } {
  const values = new Map<string, string>();
  const boolean = new Set<string>();
  const takesValue = new Set(['--file', '--find', '--replace', '--test', '--name', '--spec']);
  const switches = new Set(['--json', '--keep', '--all']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    }
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
  const rel = relative(CWD, resolve(CWD, file));
  if (outside(rel)) usage(`'${file}' is outside the worktree; the revert runs here`);
  return rel;
}

/** `..`, `../x` or an absolute path (a different drive on Windows) — not a path inside. */
function outside(rel: string): boolean {
  return isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`);
}

/**
 * The only path this tool may write. Lexical containment is not enough — the
 * previous version sliced `CWD.length + 1`, so `../<cwd-basename>-probe/x`
 * lost its `../` and read as inside — and a symlink can point out even when the
 * lexical path is inside, so the real path is checked too.
 */
function locate(file: string): { rel: string; abs: string } {
  const rel = relativeToCwd(file);
  const abs = resolve(CWD, file);
  if (existsSync(abs)) {
    const real = relative(REAL_CWD, realpathSync(abs));
    if (outside(real)) {
      usage(`'${file}' resolves outside the worktree; the revert runs here`);
    }
  }
  return { rel, abs };
}

/**
 * A mutation is only revertible if git has a pre-image for the path. An ignored
 * or untracked file has none — and `git status` cannot even see it afterwards,
 * so the mutation would silently outlive the run.
 */
function requireTracked(rel: string): void {
  const result = git(['ls-files', '--error-unmatch', '--', rel]);
  if (result.code !== 0) {
    usage(
      `'${rel}' is not tracked by git: a mutation there has no pre-image to revert. ` +
        'Commit it, or mutate a tracked file.',
    );
  }
}

/** Restore one path and prove it: the checkout's exit code, then a diff of that path. */
function revertPath(rel: string): string | null {
  const checkout = git(['checkout', '--', rel]);
  if (checkout.code !== 0) {
    return `git checkout -- ${rel} failed (exit ${checkout.code}): ${firstLine(checkout.err || checkout.out)}`;
  }
  const diff = git(['diff', '--quiet', '--', rel]);
  if (diff.code !== 0) {
    return `git checkout -- ${rel} left a diff (exit ${diff.code}); the mutation may still be applied`;
  }
  return null;
}

/** The mutator proves tests; editing them is the coordinator's job (TRIM), not this tool's. */
function assertNotATest(rel: string): void {
  const isTest = rel.split(sep).includes('__tests__') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
  if (isTest) {
    usage(
      `refusing to mutate the test file '${rel}'. This tool breaks production code and reverts it; ` +
        'removing an assertion is a TRIM, owned by whoever reviews the suite.',
    );
  }
}

interface Planned {
  mutation: Mutation;
  /** Worktree-relative path of the mutated file. */
  rel: string;
  /** Absolute path written to; never derived by string slicing. */
  abs: string;
  /** Worktree-relative test path. */
  test: string;
}

/**
 * A kill has to survive its own unmutated re-run. A test that is red under the
 * mutation and red again without it did not prove the mutation — it was flaky,
 * and a flake manufactures a `KILLED` that no automated consumer can tell apart.
 */
function confirmFlake(result: RunResult, test: string): string | null {
  if (!result.report) return result.note || 'the unmutated re-run produced no report';
  if (result.executed !== 1) {
    return `the unmutated re-run executed ${result.executed} tests in ${test}, not one`;
  }
  if (result.failed > 0) {
    return `the test fails without the mutation (${result.failure ?? 'no message'})`;
  }
  return null;
}

function mutate(bin: string, planned: Planned): { report: Report; reverted: boolean } {
  const { rel, abs, test, mutation } = planned;
  const base = { file: rel, find: mutation.find, test, title: mutation.name };
  const report = (outcome: Outcome, executed: number, detail: string): Report => ({
    ...base,
    outcome,
    executed,
    detail,
  });
  const error = (executed: number, detail: string) => ({
    report: report('ERROR', executed, detail),
    reverted: !keep,
  });

  const original = readFileSync(abs, 'utf8');
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
  const before = runTest(bin, test, mutation.name);
  const blocker = baselineError(before, mutation.name, test);
  if (blocker) return error(before.executed, `baseline: ${blocker}; an error is never proof`);

  writeFileSync(abs, original.split(mutation.find).join(mutation.replace));
  let after: RunResult | null = null;
  let revertFailure: string | null = null;
  try {
    after = runTest(bin, test, mutation.name);
  } finally {
    if (keep) {
      process.stderr.write(
        `mutate: --keep left ${rel} mutated; restore it with git checkout -- ${rel}\n`,
      );
    } else {
      revertFailure = revertPath(rel);
      if (revertFailure === null) {
        const leftover = status();
        if (leftover !== '') revertFailure = `the worktree is dirty after the revert:\n${leftover}`;
      }
      if (revertFailure !== null)
        process.stderr.write(`mutate: REVERT FAILED — ${revertFailure}\n`);
    }
  }

  if (revertFailure !== null) {
    return {
      report: report('ERROR', after?.executed ?? 0, `REVERT FAILED — ${revertFailure}`),
      reverted: false,
    };
  }
  if (after === null)
    return error(0, 'the mutated run produced no result; an error is never proof');

  const { outcome, detail } = classify(after, mutation.name, test);
  if (outcome !== 'KILLED')
    return { report: report(outcome, after.executed, detail), reverted: !keep };
  if (keep) {
    return {
      report: report(
        'KILLED',
        after.executed,
        `${detail} (flake check skipped: --keep left the mutation applied)`,
      ),
      reverted: false,
    };
  }

  const confirm = runTest(bin, test, mutation.name);
  const flake = confirmFlake(confirm, test);
  if (flake) return error(confirm.executed, `flake suspected: ${flake}; an error is never proof`);
  return { report: report('KILLED', after.executed, detail), reverted: true };
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

  const planned: Planned[] = mutations.map((mutation) => {
    if (mutation.find === mutation.replace) {
      usage('--find and --replace are identical: that is not a mutation');
    }
    const file = locate(mutation.file);
    const test = locate(mutation.test);
    if (!existsSync(file.abs)) usage(`no such file: ${mutation.file}`);
    if (!existsSync(test.abs)) usage(`no such test file: ${mutation.test}`);
    assertNotATest(file.rel);
    requireTracked(file.rel);
    return { mutation, rel: file.rel, abs: file.abs, test: test.rel };
  });

  requireClean('before the first mutation');
  const bin = vitestBin();
  const reports: Report[] = [];

  for (const [index, row] of planned.entries()) {
    const { mutation, rel, test } = row;
    say(`\n[${index + 1}/${planned.length}] ${rel}`);
    say(`  find:    ${mutation.find.split('\n')[0]}`);
    say(`  replace: ${mutation.replace.split('\n')[0]}`);
    say(`  test:    ${test}`);
    say(`  title:   ${mutation.name}`);
    const result = mutate(bin, row);
    const { report } = result;
    reports.push(report);
    if (json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      say(`  outcome: ${report.outcome} (${report.executed} executed) — ${report.detail}`);
      if (result.reverted) say('  revert:  clean');
    }
    if (report.outcome === 'ERROR' && status() !== '') {
      // A dirty tree is the one ERROR a table cannot continue past, but every
      // row still gets a line: a missing row reads as "fine" to a consumer.
      const remaining = planned.slice(index + 1);
      if (remaining.length > 0) {
        say('  stopping the table: the worktree is dirty after a failed revert');
      }
      for (const rest of remaining) {
        const skipped: Report = {
          file: rest.rel,
          find: rest.mutation.find,
          test: rest.test,
          title: rest.mutation.name,
          outcome: 'ERROR',
          executed: 0,
          detail: 'not run: a previous row left the worktree dirty',
        };
        reports.push(skipped);
        if (json) process.stdout.write(`${JSON.stringify(skipped)}\n`);
        else say(`[${reports.length}/${planned.length}] ${rest.rel}: not run — dirty worktree`);
      }
      break;
    }
  }

  const counts = { KILLED: 0, SURVIVED: 0, ERROR: 0 };
  for (const report of reports) counts[report.outcome] += 1;
  say(
    `\n${reports.length} mutation(s): ${counts.KILLED} KILLED, ${counts.SURVIVED} SURVIVED, ${counts.ERROR} ERROR`,
  );
  if (counts.ERROR > 0) process.exit(1);
}

main();
