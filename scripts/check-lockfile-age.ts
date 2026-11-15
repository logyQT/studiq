#!/usr/bin/env bun
/**
 * Lockfile release-age gate: fail a `bun.lock` change that pulls in a package
 * version published less than `[install] minimumReleaseAge` ago (7 days).
 *
 * Why this exists next to Dependabot's `cooldown` (.github/dependabot.yml):
 * `cooldown` filters only the dependency Dependabot *proposes*. For npm-family
 * lockfiles a direct bump re-resolves the tree, so a brand-new **transitive**
 * package can ride along with a perfectly safe direct bump, and the hosted
 * updater's handling of those resolutions is not observable from here. This
 * check reads the artifact we actually merge — the lockfile diff — so it
 * covers whatever produced it, hosted updater or human `bun update`.
 *
 * Wired into the `checks` CI job (see .github/workflows/verify.yml), *before*
 * `bun install`, so a suspicious lockfile fails before any of it is installed.
 * It is deliberately not part of `bun run lint`: it needs the network, and a
 * pre-commit hook must work offline.
 *
 * Scope: only versions that are new relative to the base branch are checked.
 * Everything already on the base is assumed reviewed — re-checking all 800+
 * every run is slow and would gate unrelated churn.
 *
 * Usage:
 *   bun scripts/check-lockfile-age.ts            # compares against origin/main
 *   bun scripts/check-lockfile-age.ts <base-ref>  # or BASE_REF=… ; CI passes FETCH_HEAD
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LOCKFILE = 'bun.lock';
const REGISTRY = 'https://registry.npmjs.org';
const REQUEST_TIMEOUT_MS = 15_000;
const LOOKUP_CONCURRENCY = 4;
/** Fallback when `bunfig.toml` cannot be read; keep in step with it. */
const DEFAULT_MIN_AGE_SECONDS = 604_800;
const DAY_MS = 86_400_000;
/** Registry versions only: skips `workspace:`, `file:`, `link:`, git and tarball specs. */
const REGISTRY_VERSION = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

/**
 * Policy exemptions. Empty by design: a bump that has not sat for a week should
 * be an explicit decision in the PR, not a standing allowance. Prefer waiting
 * or pinning the previous version; if an entry is genuinely needed, put the
 * reason next to it. `name` exempts every version, `name@1.2.3` one release.
 */
const ALLOWLIST = new Set<string>();

interface FreshVersion {
  name: string;
  version: string;
  /** ISO publish time, or null when the registry could not tell us. */
  published: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function git(args: string[]): GitResult {
  // `show` returns the whole lockfile: keep well clear of the 1 MiB default.
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // A spawn failure (no `git` on PATH) sets `error` and leaves stderr empty;
  // surface it, or the caller reports a failure with no reason attached.
  const stderr = result.error ? errorMessage(result.error) : (result.stderr ?? '');
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr };
}

/**
 * `bun.lock` is JSONC: Bun writes trailing commas, so the text has to be
 * normalised before `JSON.parse`. Comments are not written by Bun, and
 * stripping them generically would corrupt string values (URLs, base64).
 *
 * Returns the `name@version` specs themselves rather than a name -> version
 * map: one lockfile can hold several versions of the same package (when peer
 * ranges disagree), and keying by name silently drops all but one of them —
 * potentially the very entry a new resolution added.
 */
function parseLockfile(text: string): Set<string> {
  const parsed: unknown = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1'));
  const specs = new Set<string>();
  if (!isRecord(parsed) || !isRecord(parsed.packages)) return specs;
  for (const entry of Object.values(parsed.packages)) {
    if (Array.isArray(entry) && typeof entry[0] === 'string') specs.add(entry[0]);
  }
  return specs;
}

/** Split a spec into package name and version; `@scope/pkg@1.0.0` -> (`@scope/pkg`, `1.0.0`). */
function splitSpec(spec: string): { name: string; version: string } | null {
  // Scoped names start with `@`, so the version separator is the *last* `@`.
  const separator = spec.lastIndexOf('@');
  if (separator <= 0) return null;
  return { name: spec.slice(0, separator), version: spec.slice(separator + 1) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

/**
 * The minimum age in seconds, read from the same `bunfig.toml` Bun obeys. Only
 * a missing file, an absent `[install]` table or an absent key falls back to
 * the default: an unreadable file or a malformed value means this gate and Bun
 * disagree about the window, which is worse than failing loudly.
 */
function minimumAgeSeconds(): number {
  let text: string;
  try {
    text = readFileSync('bunfig.toml', 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return DEFAULT_MIN_AGE_SECONDS;
    throw new Error(`cannot read bunfig.toml: ${errorMessage(error)}`);
  }

  let config: unknown;
  try {
    config = Bun.TOML.parse(text);
  } catch (error) {
    throw new Error(`cannot parse bunfig.toml: ${errorMessage(error)}`);
  }

  if (!isRecord(config) || !isRecord(config.install)) return DEFAULT_MIN_AGE_SECONDS;
  const value = config.install.minimumReleaseAge;
  if (value === undefined) return DEFAULT_MIN_AGE_SECONDS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `[install] minimumReleaseAge in bunfig.toml must be a positive number of seconds, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Publish time from the npm packument, or null when it cannot be established. */
async function publishTime(name: string, version: string): Promise<string | null> {
  const url = `${REGISTRY}/${name.replace('/', '%2F')}`;
  let reason = 'no publish time in registry metadata';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404) {
        reason = 'package not found on the public registry';
        break;
      }
      if (!response.ok) {
        reason = `registry responded ${response.status}`;
        continue;
      }
      const body: unknown = await response.json();
      const times = isRecord(body) && isRecord(body.time) ? body.time : null;
      const published = times?.[version];
      if (typeof published === 'string') return published;
      break;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  console.warn(`  ! ${name}@${version}: publish time unavailable (${reason})`);
  return null;
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const queue = [...items];
  const results: R[] = [];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      results.push(await fn(item));
    }
  });
  await Promise.all(workers);
  return results;
}

function describeAge(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${(ms / DAY_MS).toFixed(1)}d`;
}

function isAllowlisted(name: string, version: string): boolean {
  return ALLOWLIST.has(name) || ALLOWLIST.has(`${name}@${version}`);
}

async function main(): Promise<number> {
  const requested = process.argv[2] ?? process.env.BASE_REF ?? 'main';
  const baseRef = [requested, `origin/${requested}`].find(
    (ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok,
  );
  if (!baseRef) {
    console.error(`x cannot resolve base ref "${requested}" — nothing to compare against.`);
    return 1;
  }

  // CI passes FETCH_HEAD; name the thing the operator can recognise.
  const baseLabel = baseRef === 'FETCH_HEAD' ? 'the PR base (FETCH_HEAD)' : baseRef;

  // `ls-tree` answers "is the path in this tree" separately from "can I read
  // it", so a genuinely absent path is the only case that may skip the gate.
  const tree = git(['ls-tree', '--name-only', baseRef, '--', LOCKFILE]);
  if (!tree.ok) {
    console.error(`x cannot list ${LOCKFILE} at ${baseLabel}: ${tree.stderr.trim()}`);
    return 1;
  }
  const baseHasLockfile = tree.stdout.split('\n').some((line) => line.trim() === LOCKFILE);

  const headFile = Bun.file(LOCKFILE);
  const headExists = await headFile.exists();

  if (!baseHasLockfile) {
    console.log(
      headExists
        ? `- ${LOCKFILE} is new relative to ${baseLabel} (no lockfile at the base): nothing to diff against, skipping.`
        : `- no ${LOCKFILE} at ${baseLabel} or in the working tree, nothing to check.`,
    );
    return 0;
  }

  // A deleted lockfile is not a no-op: `bun install --frozen-lockfile` would
  // resolve from package.json instead, which is exactly the unchecked path this
  // gate exists to close.
  if (!headExists) {
    console.error(
      `x ${LOCKFILE} exists at ${baseLabel} but is missing from the working tree — a deleted lockfile cannot be checked.`,
    );
    return 1;
  }

  const baseText = git(['show', `${baseRef}:${LOCKFILE}`]);
  if (!baseText.ok) {
    console.error(`x cannot read ${LOCKFILE} at ${baseLabel}: ${baseText.stderr.trim()}`);
    return 1;
  }

  const base = parseLockfile(baseText.stdout);
  const head = parseLockfile(await headFile.text());

  const changed = [...head]
    .filter((spec) => !base.has(spec))
    .map(splitSpec)
    .filter((pkg): pkg is { name: string; version: string } => pkg !== null)
    .filter((pkg) => REGISTRY_VERSION.test(pkg.version) && !isAllowlisted(pkg.name, pkg.version))
    .map((pkg): FreshVersion => ({ ...pkg, published: null }));

  if (changed.length === 0) {
    console.log(`✓ lockfile release age: no new package versions relative to ${baseLabel}.`);
    return 0;
  }

  let minAgeSeconds: number;
  try {
    minAgeSeconds = minimumAgeSeconds();
  } catch (error) {
    console.error(`x ${errorMessage(error)}`);
    return 1;
  }
  const minAgeMs = minAgeSeconds * 1000;
  const now = Date.now();
  const tooFresh: FreshVersion[] = [];
  let unverified = 0;

  const measured = await mapConcurrent(changed, LOOKUP_CONCURRENCY, async (pkg) => ({
    ...pkg,
    published: await publishTime(pkg.name, pkg.version),
  }));

  for (const pkg of measured) {
    if (pkg.published === null) {
      unverified += 1;
      tooFresh.push(pkg);
      continue;
    }
    if (now - Date.parse(pkg.published) < minAgeMs) tooFresh.push(pkg);
  }

  const days = minAgeMs / DAY_MS;
  if (tooFresh.length === 0) {
    console.log(
      `✓ lockfile release age: ${changed.length} new package version(s) relative to ${baseLabel}, all at least ${days} days old.`,
    );
    return 0;
  }

  tooFresh.sort((a, b) => a.name.localeCompare(b.name));
  console.error(
    `\n  x lockfile release age: ${tooFresh.length} of ${changed.length} new package version(s) are newer than the ${days}-day minimum:\n`,
  );
  for (const pkg of tooFresh) {
    const label = `${pkg.name}@${pkg.version}`;
    if (pkg.published === null) {
      console.error(`    - ${label} — publish time could not be verified`);
      continue;
    }
    const ageMs = now - Date.parse(pkg.published);
    const readyOn = new Date(Date.parse(pkg.published) + minAgeMs).toISOString().slice(0, 10);
    console.error(
      `    - ${label} — published ${pkg.published.slice(0, 10)} (${describeAge(ageMs)} ago), eligible ${readyOn}`,
    );
  }
  console.error(
    '\n    Wait for the eligible date, or pin the previous version. A bump that must\n' +
      '    land early is a deliberate decision: add it to ALLOWLIST in\n' +
      '    scripts/check-lockfile-age.ts with a reason, in this PR.\n' +
      (unverified > 0
        ? `    ${unverified} package(s) had no publish time; re-run before assuming a registry fault.\n`
        : ''),
  );
  return 1;
}

process.exitCode = await main();
