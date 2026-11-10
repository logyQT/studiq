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
import { execFileSync } from 'node:child_process';
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

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * `bun.lock` is JSONC: Bun writes trailing commas, so the text has to be
 * normalised before `JSON.parse`. Comments are not written by Bun, and
 * stripping them generically would corrupt string values (URLs, base64).
 */
function parseLockfile(text: string): Map<string, string> {
  const parsed: unknown = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1'));
  const versions = new Map<string, string>();
  if (!isRecord(parsed) || !isRecord(parsed.packages)) return versions;
  for (const entry of Object.values(parsed.packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    const spec = entry[0];
    // Scoped names start with `@`, so the version separator is the *last* `@`.
    const separator = spec.lastIndexOf('@');
    if (separator <= 0) continue;
    versions.set(spec.slice(0, separator), spec.slice(separator + 1));
  }
  return versions;
}

/** The minimum age in seconds, read from the same `bunfig.toml` Bun obeys. */
function minimumAgeSeconds(): number {
  try {
    const config: unknown = Bun.TOML.parse(readFileSync('bunfig.toml', 'utf8'));
    if (!isRecord(config) || !isRecord(config.install)) return DEFAULT_MIN_AGE_SECONDS;
    const value = config.install.minimumReleaseAge;
    return typeof value === 'number' && value > 0 ? value : DEFAULT_MIN_AGE_SECONDS;
  } catch {
    return DEFAULT_MIN_AGE_SECONDS;
  }
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
    (ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null,
  );
  if (!baseRef) {
    console.error(`x cannot resolve base ref "${requested}" — nothing to compare against.`);
    return 1;
  }

  // CI passes FETCH_HEAD; name the thing the operator can recognise.
  const baseLabel = baseRef === 'FETCH_HEAD' ? 'the PR base (FETCH_HEAD)' : baseRef;

  const baseText = git(['show', `${baseRef}:${LOCKFILE}`]);
  if (baseText === null) {
    console.log(
      `- no ${LOCKFILE} at ${baseLabel}: treating this as the first lockfile, nothing to diff.`,
    );
    return 0;
  }

  const headFile = Bun.file(LOCKFILE);
  if (!(await headFile.exists())) {
    console.log(`- no ${LOCKFILE} in the working tree, nothing to check.`);
    return 0;
  }

  const base = parseLockfile(baseText);
  const head = parseLockfile(await headFile.text());

  const changed = [...head.entries()]
    .filter(([name, version]) => REGISTRY_VERSION.test(version) && base.get(name) !== version)
    .filter(([name, version]) => !isAllowlisted(name, version))
    .map(([name, version]): FreshVersion => ({ name, version, published: null }));

  if (changed.length === 0) {
    console.log(`✓ lockfile release age: no new package versions relative to ${baseLabel}.`);
    return 0;
  }

  const minAgeMs = minimumAgeSeconds() * 1000;
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
