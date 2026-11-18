#!/usr/bin/env bun
/**
 * ADR-0014 §5, re-runnable: does seeding the Turbopack cache root change what
 * the build emits?
 *
 * Three production builds, sequential, in one checkout:
 *
 *   cold1   no `.next` at all — its `turbopack/` becomes the seed
 *   seeded  no `.next`, then `cold1`'s `turbopack/` copied into `.next/cache`
 *   cold2   no `.next` again — the noise floor
 *
 * A cold build is not deterministic: `BUILD_ID` and everything derived from it,
 * three preview-mode values, the RSC server-reference-manifest encryption key and
 * the sitemap's `<lastmod>` are new on every run. So "a seeded build is the same
 * build" only means anything against two cold builds. The check this script
 * exits on is: every file the seeded arm differs from `cold1` in must also differ
 * between two cold builds, and every difference must be one of those known-random
 * values. No difference may be unexplained.
 *
 * The timings are reported beside that verdict, with the three indicators that
 * distinguish a cache hit from a faster machine (compile span, cache bytes
 * written, the `turbopack-compaction` span). The wall column is spawn-to-exit and
 * includes any wait for a build slot, so it is context, not evidence: the queue
 * wait is reported and subtracted, and the reproducible form of the claim is the
 * compile ratio and the bytes written. A seeded arm that did not actually hit is
 * reported as INCONCLUSIVE, never as a pass.
 *
 * Usage:
 *   bun scripts/bench/cache-equality.ts [--work-dir <path>] [--keep] [--json]
 *
 * Cost: each arm is a production build — ~30 s cold, ~12 s seeded on a 16 vCPU
 * box — so three arms take about a minute and a half, plus three copies of the
 * build output. It needs this checkout's Supabase stack
 * (`bun run env:ensure --profile api`) and **no running web server**
 * (`bun run env:down`): the build refuses to overwrite the artifact a server is
 * serving, and this script removes `.next` before each arm.
 *
 * Writes only `apps/web/.next` (what it measures) and the work dir (one per
 * checkout by default, `<tmp>/studiq-cache-equality-<checkout>-<hash8>`); the
 * build it drives also writes its own `.dev` record and runtime-registry slot.
 * `STUDIQ_CACHE_DIR` — the published snapshot root — is redirected inside the
 * work dir, so a run never writes to `${XDG_CACHE_HOME}/studiq`; the Turbopack
 * cache under test is `apps/web/.next/cache/turbopack`, which every arm deletes.
 * The published-snapshot seed is disabled, so a "cold" arm is really cold.
 *
 * The work dir is deleted at the start of a run, so a value that is this
 * checkout, contains it, sits inside it, is the temp root itself, or is outside
 * the temp root is refused before anything is touched.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, not `import.meta.dir`: the unit test imports this module
// under Vitest, where the Bun-only `import.meta.dir` is undefined.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_NEXT = join(REPO_ROOT, 'apps', 'web', '.next');
const TURBOPACK_CACHE = join(WEB_NEXT, 'cache', 'turbopack');
const FAILURE_TAIL_LINES = 20;

/**
 * Paths that are inputs or traces rather than build output. `cache/` is the
 * cache under test (the seeded arm writes a fraction of it), `trace` and
 * `trace-build` are the harness's own timing source, and `BUILD_ID` is compared
 * through its derivations instead of as one file.
 */
const EXCLUDED_FILES = new Set(['BUILD_ID', 'trace', 'trace-build']);

/**
 * The per-build random values, each proven random by the cold-vs-cold arm. A
 * file that differs but normalises to the same bytes with these rules is
 * explained; anything left is a finding.
 */
const RANDOM_RULES: ReadonlyArray<{ kind: string; pattern: RegExp; replacement: string }> = [
  {
    kind: 'previewModeId',
    pattern: /"previewModeId": *"[0-9a-f]{32}"/g,
    replacement: '"previewModeId": "_RANDOM_"',
  },
  {
    kind: 'previewModeSigningKey',
    pattern: /"previewModeSigningKey": *"[0-9a-f]{64}"/g,
    replacement: '"previewModeSigningKey": "_RANDOM_"',
  },
  {
    kind: 'previewModeEncryptionKey',
    pattern: /"previewModeEncryptionKey": *"[0-9a-f]{64}"/g,
    replacement: '"previewModeEncryptionKey": "_RANDOM_"',
  },
  {
    kind: 'server-reference-manifest.encryptionKey',
    pattern: /"encryptionKey": *"[A-Za-z0-9+/=]{40,}"/g,
    replacement: '"encryptionKey": "_RANDOM_"',
  },
  {
    kind: 'server-reference-manifest.encryptionKey',
    pattern: /\\"encryptionKey\\": *\\"[A-Za-z0-9+/=]{40,}\\"/g,
    replacement: '\\"encryptionKey\\": \\"_RANDOM_\\"',
  },
  {
    kind: 'sitemap.lastmod',
    pattern: /<lastmod>[^<]*<\/lastmod>/g,
    replacement: '<lastmod>_BUILD_TIME_</lastmod>',
  },
];

interface Options {
  /** The operator's `--work-dir`, or null for the per-checkout default. */
  workDir: string | null;
  keep: boolean;
  json: boolean;
}

interface TraceSpan {
  name: string;
  duration: number;
  tags: Record<string, unknown> | undefined;
}

interface ArmMetrics {
  arm: string;
  /** Spawn-to-exit of `env:build`: includes any wait for a build slot. */
  wallMs: number;
  /** That wait, from the build's admitted line; null when the log has none. */
  queuedMs: number | null;
  buildId: string;
  nextBuildMs: number | null;
  compileMs: number | null;
  typescriptMs: number | null;
  cacheBytesWritten: number | null;
  compactionMs: number | null;
  cacheBytes: number;
  cacheFiles: number;
}

interface FileDifference {
  path: string;
  kinds: string[];
  explained: boolean;
}

interface TreeDiff {
  comparedFiles: number;
  onlyA: string[];
  onlyB: string[];
  differing: FileDifference[];
  unexplained: string[];
}

interface CacheHit {
  confirmed: boolean;
  compileRatio: number | null;
  bytesRatio: number | null;
  compactionSpan: boolean;
}

interface Report {
  ok: boolean;
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  workDir: string;
  arms: ArmMetrics[];
  noise: TreeDiff;
  subject: TreeDiff;
  /** Subject differences whose path the cold-vs-cold pair never differed in. */
  novelDifferences: string[];
  /** Why the verdict is not PASS, or null. */
  reason: string | null;
  cacheHit: CacheHit;
}

function usageError(message: string): never {
  process.stderr.write(`cache-equality: ${message}\n`);
  process.stderr.write("cache-equality: run 'bun scripts/bench/cache-equality.ts --help'\n");
  process.exit(2);
}

function printHelp(): void {
  process.stdout.write(`Reproduce ADR-0014 §5: cold vs seeded build equality.

  bun scripts/bench/cache-equality.ts [options]

Runs three production builds of apps/web in this checkout — cold, seeded from the
cold build's Turbopack cache, cold again — and compares every emitted file except
cache/, trace, trace-build and BUILD_ID. Each arm is a production build (~30 s
cold on a 16 vCPU box), so expect about a minute and a half.

Options:
  --work-dir <path>  where arm copies and logs go (default
                     <tmp>/studiq-cache-equality-<checkout>-<hash8>). The
                     directory is deleted at the start of the run, so a value
                     that is this checkout, contains it, is inside it, is the
                     temp root itself, or is outside <tmp> is refused before
                     anything is deleted.
  --keep             keep the copied .next trees; a failing run keeps them anyway
  --json             machine-readable report on stdout
  --help             this text

Requirements: this checkout's Supabase stack is up (bun run env:ensure --profile
api) and no web server is running (bun run env:down), because each arm removes
apps/web/.next before it builds. If the stack was started with --profile api,
'bun run env:ensure --profile web' afterwards needs 'bun run env:down --all --yes'
first: a running stack cannot gain the mail capability in place.

Verdicts, and the exit codes:
  0  PASS          every seeded-vs-cold difference is one two cold builds also
                   have, and every difference is a known per-build random value
  1  FAIL          an unexplained difference, or one the noise floor never had
  2  usage error, or a running web server (run bun run env:down)
  3  a build failed (its log is named)
  4  INCONCLUSIVE  the seeded arm did not actually hit the cache
`);
}

/**
 * One work dir per checkout: two worktrees running at once must not delete each
 * other's evidence.
 *
 * @public Exercised by the unit test through a computed file URL.
 */
export function defaultWorkDir(tmpRoot: string, repoRoot: string): string {
  const slug = basename(repoRoot)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  const label = slug === '' ? 'checkout' : slug;
  const id = createHash('sha256').update(repoRoot).digest('hex').slice(0, 8);
  return join(tmpRoot, `studiq-cache-equality-${label}-${id}`);
}

/** `path` with symlinks in its existing ancestors resolved, for containment tests. */
function canonicalPath(path: string): string {
  const resolved = resolve(path);
  const rest: string[] = [];
  let probe = resolved;
  for (;;) {
    try {
      return join(realpathSync(probe), ...rest.reverse());
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return resolved;
      rest.push(basename(probe));
      probe = parent;
    }
  }
}

/** `child` is `parent` or inside it. */
function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Why `workDir` is not a safe place to delete and rebuild, or null.
 *
 * A run's first statement removes the work dir, so a typo must not reach the
 * checkout or anything outside the temp root — `--work-dir .` from the repo root
 * is the checkout itself, and `--work-dir ..` is its parent.
 */
function workDirRefusal(workDir: string, repoRoot: string, tmpRoot: string): string | null {
  if (workDir === repoRoot) return 'it is this checkout';
  if (isWithin(workDir, repoRoot)) return 'it contains this checkout';
  if (isWithin(repoRoot, workDir)) return 'it is inside this checkout';
  if (workDir === tmpRoot) return 'it is the temp root itself';
  if (!isWithin(tmpRoot, workDir)) return `it is outside ${tmpRoot}`;
  return null;
}

export type WorkDirChoice = { ok: true; path: string } | { ok: false; reason: string };

/**
 * The directory a run may delete: the operator's `--work-dir`, or one per
 * checkout. An empty value is refused before it can resolve to the cwd.
 *
 * @public Exercised by the unit test through a computed file URL.
 */
export function chooseWorkDir(input: {
  raw: string | null;
  repoRoot: string;
  tmpRoot: string;
}): WorkDirChoice {
  if (input.raw !== null && input.raw.trim() === '') {
    return { ok: false, reason: 'an empty value would resolve to the current directory' };
  }
  const candidate =
    input.raw === null ? defaultWorkDir(input.tmpRoot, input.repoRoot) : resolve(input.raw);
  const path = canonicalPath(candidate);
  const reason = workDirRefusal(path, canonicalPath(input.repoRoot), canonicalPath(input.tmpRoot));
  return reason === null ? { ok: true, path } : { ok: false, reason };
}

function parseOptions(argv: readonly string[]): Options | null {
  let workDir: string | null = null;
  let keep = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === '--help' || arg === '-h') return null;
    if (arg === '--keep') {
      keep = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--work-dir') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) usageError('--work-dir needs a path');
      workDir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--work-dir=')) {
      workDir = arg.slice('--work-dir='.length);
      continue;
    }
    usageError(`unknown argument '${arg}'`);
  }
  return { workDir, keep, json };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Refuse before touching `.next`: the first arm deletes the artifact a running
 * server is serving, and `env:build` would only refuse after that.
 *
 * This reads the same `.dev/web.pid` the tool writes, and treats "cannot prove it
 * is dead" as alive so the refusal is the safe direction.
 */
function assertNoWebServer(): void {
  const configured = process.env['STUDIQ_ENV_STATE_DIR'];
  const stateDir =
    configured === undefined ? join(REPO_ROOT, '.dev') : resolve(REPO_ROOT, configured);
  let raw: string;
  try {
    raw = readFileSync(join(stateDir, 'web.pid'), 'utf8');
  } catch {
    return;
  }
  const first = raw.split(/\s+/)[0];
  const pid = Number(first);
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (isErrno(error) && error.code === 'ESRCH') return;
  }
  usageError(
    `this checkout's web server (pid ${pid}) owns apps/web/.next; run 'bun run env:down' first`,
  );
}

function buildEnv(workDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // The only seed this script measures is the one it copies itself; a
    // published snapshot must not turn a "cold" arm warm.
    STUDIQ_CACHE_SEED: '0',
    // Keep the snapshot machinery away from the real cache root, so staging (in
    // a primary checkout) writes into the work dir and never ~/.cache/studiq.
    STUDIQ_CACHE_DIR: join(workDir, 'cache-root'),
  };
}

interface BuildOutcome {
  exitCode: number;
  wallMs: number;
  logPath: string;
}

async function runBuild(name: string, workDir: string): Promise<BuildOutcome> {
  const logPath = join(workDir, `${name}.log`);
  const fd = openSync(logPath, 'w');
  const startedAt = Date.now();
  try {
    const exitCode = await new Promise<number>((resolvePromise, reject) => {
      const child = spawn(process.execPath, ['run', 'env:build', '--force'], {
        cwd: REPO_ROOT,
        env: buildEnv(workDir),
        stdio: ['ignore', fd, fd],
      });
      child.on('error', reject);
      child.on('close', (status) => resolvePromise(status ?? 1));
    });
    return { exitCode, wallMs: Date.now() - startedAt, logPath };
  } finally {
    closeSync(fd);
  }
}

/** Remove `.next`, then seed `turbopack/` into it when a seed is supplied. */
function prepareArm(seed: string | null): void {
  rmSync(WEB_NEXT, { recursive: true, force: true });
  if (seed === null) return;
  mkdirSync(join(WEB_NEXT, 'cache'), { recursive: true });
  cpSync(seed, TURBOPACK_CACHE, { recursive: true });
}

/** Every non-directory entry under `root`, with the path `root` relativises from. */
function* walkFiles(root: string): Generator<{ rel: string; path: string; entry: Dirent }> {
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else yield { rel: relative(root, path), path, entry };
    }
  }
}

/** Bytes and file count of a directory, the `du -sb` / `find | wc -l` pair §5 quotes. */
function directoryStats(root: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  if (!existsSync(root)) return { bytes, files };
  for (const { path, entry } of walkFiles(root)) {
    if (!entry.isFile()) continue;
    bytes += statSync(path).size;
    files += 1;
  }
  return { bytes, files };
}

/** `rename`, with a copy fallback when `--work-dir` is on another filesystem. */
function moveDirectory(from: string, to: string): void {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch {
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

function isExcluded(rel: string): boolean {
  return rel === 'cache' || rel.startsWith(`cache${sep}`) || EXCLUDED_FILES.has(rel);
}

/** Copy the emitted tree aside, without the cache the next arm replaces anyway. */
function copyOutputTree(name: string, workDir: string): void {
  const destination = join(workDir, name);
  rmSync(destination, { recursive: true, force: true });
  cpSync(WEB_NEXT, destination, {
    recursive: true,
    // Keep a symlink a symlink: `dereference` would copy its target instead and
    // hide a difference in the link itself behind a whole tree.
    verbatimSymlinks: true,
    filter: (src) => !isExcluded(relative(WEB_NEXT, src)),
  });
}

function readSpans(path: string): TraceSpan[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): TraceSpan[] => {
    if (!isRecord(item)) return [];
    const name = item['name'];
    const duration = item['duration'];
    if (typeof name !== 'string' || typeof duration !== 'number') return [];
    const tags = isRecord(item['tags']) ? item['tags'] : undefined;
    return [{ name, duration, tags }];
  });
}

function spanMillis(spans: readonly TraceSpan[], name: string): number | null {
  const span = spans.find((candidate) => candidate.name === name);
  return span === undefined ? null : span.duration / 1000;
}

function spanBytesWritten(spans: readonly TraceSpan[]): number | null {
  const span = spans.find((candidate) => candidate.name === 'turbopack-persistence');
  const value = span?.tags?.['bytes_written'];
  return typeof value === 'number' ? value : null;
}

interface ArmInput {
  name: string;
  seed: string | null;
  workDir: string;
  /** Move the arm's own `turbopack/` out as the seed for the next arm. */
  keepTurbopackAsSeed: boolean;
}

async function measureArm(input: ArmInput): Promise<ArmMetrics> {
  prepareArm(input.seed);
  const outcome = await runBuild(input.name, input.workDir);
  if (outcome.exitCode !== 0) {
    const tail = readFailureTail(outcome.logPath);
    process.stderr.write(`cache-equality: ${input.name} build failed (exit ${outcome.exitCode})\n`);
    if (tail !== '') process.stderr.write(`${tail}\n`);
    process.stderr.write(`cache-equality: full log: ${outcome.logPath}\n`);
    process.exit(3);
  }
  let buildId: string;
  try {
    buildId = readFileSync(join(WEB_NEXT, 'BUILD_ID'), 'utf8').trim();
  } catch {
    process.stderr.write(
      `cache-equality: ${input.name} exited 0 but left no apps/web/.next/BUILD_ID; see ${outcome.logPath}\n`,
    );
    process.exit(3);
  }
  const spans = readSpans(join(WEB_NEXT, 'trace-build'));
  const stats = directoryStats(TURBOPACK_CACHE);
  const metrics: ArmMetrics = {
    arm: input.name,
    wallMs: outcome.wallMs,
    queuedMs: readQueuedMs(outcome.logPath),
    buildId,
    nextBuildMs: spanMillis(spans, 'next-build'),
    compileMs: spanMillis(spans, 'run-turbopack'),
    typescriptMs: spanMillis(spans, 'run-typescript'),
    cacheBytesWritten: spanBytesWritten(spans),
    compactionMs: spanMillis(spans, 'turbopack-compaction'),
    cacheBytes: stats.bytes,
    cacheFiles: stats.files,
  };
  if (input.keepTurbopackAsSeed) {
    moveDirectory(TURBOPACK_CACHE, join(input.workDir, 'seed', 'turbopack'));
  }
  copyOutputTree(input.name, input.workDir);
  return metrics;
}

function readFailureTail(logPath: string): string {
  try {
    const lines = readFileSync(logPath, 'utf8').split('\n');
    return lines.slice(-FAILURE_TAIL_LINES).join('\n').trimEnd();
  } catch {
    return '';
  }
}

/**
 * `build: building|admitted apps/web (… after 12.3s)` is the only place the
 * slot wait is stated; the last match is the arm that just ran.
 */
const QUEUED_LINE =
  /build: (?:admitted|building) apps\/(?:web|admin) \([^)]*\bafter (\d+(?:\.\d+)?)s\)/g;

function readQueuedMs(logPath: string): number | null {
  let text: string;
  try {
    text = readFileSync(logPath, 'utf8');
  } catch {
    return null;
  }
  let queuedMs: number | null = null;
  for (const match of text.matchAll(QUEUED_LINE)) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds)) queuedMs = Math.round(seconds * 1000);
  }
  return queuedMs;
}

/** Replace this tree's `BUILD_ID` so the `static/<id>/` directory name compares. */
function normalisePath(rel: string, buildId: string): string {
  return rel.split(buildId).join('_BUILDID_');
}

interface TreeEntry {
  rel: string;
  digest: string;
}

function snapshotTree(root: string, buildId: string): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  for (const { rel, path, entry } of walkFiles(root)) {
    if (isExcluded(rel)) continue;
    const digest = entry.isSymbolicLink()
      ? createHash('sha256')
          .update(`symlink:${readlinkSync(path)}`)
          .digest('hex')
      : createHash('sha256').update(readFileSync(path)).digest('hex');
    entries.set(normalisePath(rel, buildId), { rel, digest });
  }
  return entries;
}

function normaliseBytes(bytes: Buffer, buildId: string): { normalised: Buffer; kinds: string[] } {
  // latin1 round-trips every byte, so this works on the binary chunk files too.
  let text = bytes.toString('latin1');
  const kinds = new Set<string>();
  if (buildId !== '' && text.includes(buildId)) {
    kinds.add('build-id');
    text = text.split(buildId).join('_BUILDID_');
  }
  for (const rule of RANDOM_RULES) {
    const replaced = text.replace(rule.pattern, rule.replacement);
    if (replaced !== text) {
      kinds.add(rule.kind);
      text = replaced;
    }
  }
  return { normalised: Buffer.from(text, 'latin1'), kinds: [...kinds] };
}

function normaliseFilePair(
  aPath: string,
  aId: string,
  bPath: string,
  bId: string,
): { equal: boolean; kinds: string[] } {
  const a = normaliseBytes(readFileSync(aPath), aId);
  const b = normaliseBytes(readFileSync(bPath), bId);
  return {
    equal: a.normalised.equals(b.normalised),
    kinds: [...new Set([...a.kinds, ...b.kinds])],
  };
}

/**
 * @public Compare two emitted trees; exercised by the unit test through a
 * computed file URL, which knip cannot follow.
 */
export function compareTrees(aRoot: string, aId: string, bRoot: string, bId: string): TreeDiff {
  const a = snapshotTree(aRoot, aId);
  const b = snapshotTree(bRoot, bId);
  const onlyA = [...a.keys()].filter((key) => !b.has(key)).sort();
  const onlyB = [...b.keys()].filter((key) => !a.has(key)).sort();
  const differing: FileDifference[] = [];
  let comparedFiles = 0;
  for (const [key, entryA] of a) {
    const entryB = b.get(key);
    if (entryB === undefined) continue;
    comparedFiles += 1;
    if (entryA.digest === entryB.digest) continue;
    const normalised = normaliseFilePair(
      join(aRoot, entryA.rel),
      aId,
      join(bRoot, entryB.rel),
      bId,
    );
    differing.push({ path: key, kinds: normalised.kinds, explained: normalised.equal });
  }
  differing.sort((left, right) => left.path.localeCompare(right.path));
  const unexplained = [
    ...differing.filter((file) => !file.explained).map((file) => file.path),
    ...onlyA,
    ...onlyB,
  ];
  return { comparedFiles, onlyA, onlyB, differing, unexplained };
}

function explainedFiles(diff: TreeDiff): FileDifference[] {
  return diff.differing.filter((file) => file.explained);
}

function differencePaths(diff: TreeDiff): Set<string> {
  return new Set([...diff.differing.map((file) => file.path), ...diff.onlyA, ...diff.onlyB]);
}

function ratio(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole === 0) return null;
  return part / whole;
}

function formatSeconds(ms: number | null): string {
  return ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`;
}

function formatMegabytes(bytes: number | null): string {
  return bytes === null ? '-' : `${Math.round(bytes / 1_000_000)} MB`;
}

function formatRatio(value: number | null): string {
  return value === null ? '-' : `${value.toFixed(2)}×`;
}

/** The build itself, once the wait for a slot is taken out of the wall time. */
function wallExcludingQueue(arm: ArmMetrics): number | null {
  return arm.queuedMs === null ? null : Math.max(0, arm.wallMs - arm.queuedMs);
}

const ARM_COLUMNS: ReadonlyArray<{ title: string; width: number }> = [
  { title: 'arm', width: 7 },
  { title: 'wall (incl. queue)', width: 18 },
  { title: 'wall−queue', width: 11 },
  { title: 'queued', width: 8 },
  { title: 'next-build', width: 10 },
  { title: 'compile', width: 8 },
  { title: 'tsc', width: 9 },
  { title: 'cache written', width: 13 },
  { title: 'cache on disk', width: 13 },
  { title: 'files', width: 5 },
  { title: 'compaction', width: 10 },
];

function armRow(arm: ArmMetrics): string {
  const cells = [
    arm.arm,
    formatSeconds(arm.wallMs),
    formatSeconds(wallExcludingQueue(arm)),
    formatSeconds(arm.queuedMs),
    formatSeconds(arm.nextBuildMs),
    formatSeconds(arm.compileMs),
    formatSeconds(arm.typescriptMs),
    formatMegabytes(arm.cacheBytesWritten),
    formatMegabytes(arm.cacheBytes),
    String(arm.cacheFiles),
    formatSeconds(arm.compactionMs),
  ];
  return cells
    .map((cell, index) => {
      const column = ARM_COLUMNS[index];
      const width = column?.width ?? 0;
      return index === 0 ? cell.padEnd(width) : cell.padStart(width);
    })
    .join('  ');
}

function printTextReport(report: Report): void {
  const lines: string[] = [];
  lines.push('cache-equality: three production builds (cold, seeded, cold)');
  lines.push('');
  lines.push(ARM_COLUMNS.map((column) => column.title.padStart(column.width)).join('  '));
  for (const arm of report.arms) lines.push(armRow(arm));
  lines.push('');
  lines.push('wall is context, not evidence: it includes any wait for a build slot (`queued`).');
  lines.push(
    '`wall−queue` is the build itself; the reproducible claim is the compile ratio and the cache bytes written.',
  );
  lines.push('');
  lines.push(
    'compared: every file under apps/web/.next except cache/, trace, trace-build and BUILD_ID',
  );
  lines.push('');
  const noise = report.noise;
  lines.push(
    `noise floor (cold1 vs cold2): ${noise.comparedFiles} files compared, ${noise.differing.length} differ, ${noise.unexplained.length} unexplained`,
  );
  for (const file of explainedFiles(noise)) {
    lines.push(`  ${file.path} — ${file.kinds.join(', ')}`);
  }
  for (const path of noise.unexplained) lines.push(`  UNEXPLAINED ${path}`);
  const subject = report.subject;
  lines.push(
    `seeded vs cold1:              ${subject.comparedFiles} files compared, ${subject.differing.length} differ, ${subject.unexplained.length} unexplained`,
  );
  for (const file of explainedFiles(subject)) {
    lines.push(`  ${file.path} — ${file.kinds.join(', ')}`);
  }
  for (const path of subject.unexplained) lines.push(`  UNEXPLAINED ${path}`);
  lines.push(
    `diff-of-diffs:                ${report.novelDifferences.length === 0 ? 'no difference the noise floor did not also have' : `${report.novelDifferences.length} difference(s) the noise floor never had`}`,
  );
  for (const path of report.novelDifferences) lines.push(`  NOVEL ${path}`);
  lines.push('');
  const hit = report.cacheHit;
  lines.push(
    `cache hit: bytes written ${formatRatio(hit.bytesRatio)} of cold, compile ${formatRatio(hit.compileRatio)} of cold, compaction span ${hit.compactionSpan ? 'present' : 'absent'}`,
  );
  lines.push(`verdict: ${report.verdict}${report.reason === null ? '' : ` — ${report.reason}`}`);
  if (!report.ok) lines.push(`evidence kept in ${report.workDir}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** @public The verdict rule; exercised by the unit test through a computed URL. */
export function verdictOf(
  noise: TreeDiff,
  subject: TreeDiff,
  novelDifferences: string[],
  buildIds: readonly string[],
  cacheHit: CacheHit,
): { verdict: Report['verdict']; reason: string | null; ok: boolean } {
  const distinctIds = new Set(buildIds).size;
  if (distinctIds !== buildIds.length) {
    return {
      verdict: 'FAIL',
      reason:
        'two arms produced the same BUILD_ID — a cold arm did not rebuild, so the comparison is void',
      ok: false,
    };
  }
  if (noise.differing.length === 0 && noise.onlyA.length === 0 && noise.onlyB.length === 0) {
    return {
      verdict: 'FAIL',
      reason:
        'two cold builds of the same tree were identical; a rebuild always randomises BUILD_ID',
      ok: false,
    };
  }
  if (noise.unexplained.length > 0) {
    return {
      verdict: 'FAIL',
      reason: `the noise floor itself has ${noise.unexplained.length} unexplained difference(s); the normalisation is incomplete`,
      ok: false,
    };
  }
  if (subject.unexplained.length > 0) {
    return {
      verdict: 'FAIL',
      reason: `the seeded arm has ${subject.unexplained.length} unexplained difference(s)`,
      ok: false,
    };
  }
  if (novelDifferences.length > 0) {
    return {
      verdict: 'FAIL',
      reason: `the seeded arm differs in ${novelDifferences.length} file(s) that two cold builds did not`,
      ok: false,
    };
  }
  if (!cacheHit.confirmed) {
    return {
      verdict: 'INCONCLUSIVE',
      reason:
        'the seeded arm did not hit the cache (cache bytes written and compile span did not drop)',
      ok: false,
    };
  }
  return { verdict: 'PASS', reason: null, ok: true };
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  if (options === null) {
    printHelp();
    return 0;
  }
  const chosen = chooseWorkDir({
    raw: options.workDir,
    repoRoot: REPO_ROOT,
    tmpRoot: tmpdir(),
  });
  if (!chosen.ok) usageError(`refusing --work-dir: ${chosen.reason}`);
  const workDir = chosen.path;
  assertNoWebServer();
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const seedDir = join(workDir, 'seed', 'turbopack');

  const cold1 = await measureArm({
    name: 'cold1',
    seed: null,
    workDir,
    keepTurbopackAsSeed: true,
  });
  const seeded = await measureArm({
    name: 'seeded',
    seed: seedDir,
    workDir,
    keepTurbopackAsSeed: false,
  });
  const cold2 = await measureArm({
    name: 'cold2',
    seed: null,
    workDir,
    keepTurbopackAsSeed: false,
  });
  const arms = [cold1, seeded, cold2];

  const noiseDiff = compareTrees(
    join(workDir, 'cold1'),
    cold1.buildId,
    join(workDir, 'cold2'),
    cold2.buildId,
  );
  const subjectDiff = compareTrees(
    join(workDir, 'cold1'),
    cold1.buildId,
    join(workDir, 'seeded'),
    seeded.buildId,
  );
  const noisePaths = differencePaths(noiseDiff);
  const novelDifferences = [...differencePaths(subjectDiff)]
    .filter((path) => !noisePaths.has(path))
    .sort();

  const bytesRatio = ratio(seeded.cacheBytesWritten, cold1.cacheBytesWritten);
  const compileRatio = ratio(seeded.compileMs, cold1.compileMs);
  const cacheHit: CacheHit = {
    confirmed:
      bytesRatio !== null && bytesRatio < 0.5 && (compileRatio === null || compileRatio < 0.9),
    compileRatio,
    bytesRatio,
    compactionSpan: seeded.compactionMs !== null,
  };

  const verdict = verdictOf(
    noiseDiff,
    subjectDiff,
    novelDifferences,
    arms.map((arm) => arm.buildId),
    cacheHit,
  );
  const report: Report = {
    ok: verdict.ok,
    verdict: verdict.verdict,
    workDir,
    arms,
    noise: noiseDiff,
    subject: subjectDiff,
    novelDifferences,
    reason: verdict.reason,
    cacheHit,
  };

  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printTextReport(report);

  if (report.ok && !options.keep) rmSync(workDir, { recursive: true, force: true });
  return report.ok ? 0 : report.verdict === 'INCONCLUSIVE' ? 4 : 1;
}

if (import.meta.main) process.exit(await main());
