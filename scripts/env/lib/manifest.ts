import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-file';
import { readContractLenient, type Contract } from './contract';
import { contractWithLease } from './contract-lease';
import type { ManifestReport } from './json';
import { buildInProgress, readBuildSlots, type BuildInProgress } from './locks';
import { writeStderrLine } from './output';
import {
  REPO_ROOT,
  currentBranchName,
  currentBranchRef,
  currentCommit,
  isPrimaryCheckout,
} from './repo';
import { readCachedStack } from './stack-cache';
import type { StackStatus } from './stack';
import {
  DEV_DIR,
  classifyRecordedArtifact,
  ensureDevDir,
  readBuildState,
  readStackState,
  type BuildArtifactState,
} from './state';
import { readWebPid } from './web';

/**
 * `.dev/env.json`: this checkout's environment state as one small file.
 *
 * The tool already knows everything an agent otherwise has to ask for — the
 * port the lease handed out silently, whether a build is running, what the
 * artifact is worth — but the only way to ask was `bun run env:status`, which
 * shells out to `supabase stack status` (and that call has failed under load,
 * issue #1360). This file is written by every mutating command instead, so
 * reading it is one `cat` with no subprocess.
 *
 * Rules the rest of the tool relies on:
 *
 * - **Derived, never hand-maintained.** Every field is produced from state the
 *   tool already holds at a state change; there is nothing here a human edits.
 * - **Written atomically** (`atomic-file.ts`), so a concurrent reader never sees
 *   a torn document, and at mode 0600 in the mode-700 `.dev/`.
 * - **Never a secret.** No keys, no tokens, no database URL, no stack env —
 *   the same rule as `qa/env.json` (ADR-0011, consequences).
 * - **`status` and `doctor` never write it** (ADR-0011 §1). Status *reconciles*
 *   it: `manifestReport` compares the file with the live probe and reports the
 *   differences instead of echoing the file back.
 * - **Absent means no command has recorded state here yet**, not "unknown".
 * - **Schema-versioned**, so a file written by another version is reported as
 *   such rather than silently misread.
 * - **`writtenAt` is the last write, not the last change.** A refused or no-op
 *   command rewrites the document with the same facts and a newer timestamp, so
 *   a later timestamp bounds freshness but never proves something changed.
 */
const MANIFEST_SCHEMA = 1;

/** `.dev/env.json`, relative to the checkout: the path an agent reads first. */
const MANIFEST_FILE = '.dev/env.json';

function manifestPath(): string {
  return join(DEV_DIR, 'env.json');
}

export interface ManifestCheckout {
  worktree: string;
  branch: string;
  commit: string | null;
  /** True when this checkout's git dir is the common dir (the publish gate's test). */
  primary: boolean;
}

export interface ManifestApp {
  /** The leased URL when neither `APP_PORT` nor `APP_URL` is set, else the resolved one. */
  url: string;
  port: number;
  /** Whether this checkout's recorded server is alive right now. */
  serving: boolean;
  pid: number | null;
}

export interface ManifestStack {
  id: string | null;
  name: string | null;
  runtime: string | null;
  running: boolean;
}

export interface ManifestBuild {
  app: 'web';
  /** The same four answers `env status` reports, or null when it cannot be computed. */
  state: BuildArtifactState | null;
  fingerprint: string | null;
  builtAt: string | null;
}

export interface ManifestSlots {
  busy: number | null;
  cap: number | null;
  waiting: number | null;
  degraded: boolean;
}

export interface ManifestBuilding {
  pid: number | null;
  /** The holder's process start time: the half of an identity a pid cannot carry. */
  start: string | null;
  slot: number | null;
}

export interface ManifestNext {
  build: string;
  serve: string;
  down: string;
}

export interface EnvManifest {
  schema: number;
  /** Last write, not last change: a refusal or a no-op still refreshes it. */
  writtenAt: string;
  checkout: ManifestCheckout;
  app: ManifestApp;
  stack: ManifestStack;
  build: ManifestBuild;
  slots: ManifestSlots;
  /** The live build while one holds this worktree's mutex, null otherwise. */
  building: ManifestBuilding | null;
  next: ManifestNext;
}

/** The command for each intent, so an agent acts instead of guessing. */
const NEXT_COMMANDS: ManifestNext = {
  build: 'bun run env:build',
  serve: 'bun run env:serve',
  // Plain `down`, not `--all`: `build` refuses while the server runs and asks
  // for `env:down`, and `--all` leaves no stack for the next `build`. These
  // three have to compose in the order an agent reads them.
  down: 'bun run env:down',
};

/** The stack facts an ensure/serve/build has just read authoritatively. */
export function stackFacts(status: StackStatus): ManifestStack {
  return {
    id: status.id,
    name: status.name,
    runtime: status.runtime,
    running: true,
  };
}

/**
 * The shared stack is not this checkout's state: `SUPABASE_SHARED=1` points at
 * a stack another checkout owns, so nothing here may claim to describe it.
 */
export function sharedStackFacts(): ManifestStack {
  return { id: null, name: 'shared', runtime: null, running: true };
}

/** This checkout has no running stack (a `down --all`, or a failed teardown). */
export function stoppedStackFacts(): ManifestStack {
  return { id: null, name: null, runtime: null, running: false };
}

export interface ManifestWriteInput {
  /** The resolved contract, when the caller already has it. */
  contract?: Contract;
  /** The stack facts the caller just proved, when it has them. */
  stack?: ManifestStack;
  at?: Date;
}

/**
 * Build the document from the files, the environment and whatever the caller
 * proved. Kept separate from the write so the values are inspectable.
 */
function buildManifest(input: ManifestWriteInput = {}): EnvManifest {
  const contract = input.contract ?? contractWithLease(readContractLenient());
  const webPid = readWebPid();
  const record = readBuildState();
  const slots = readBuildSlots();
  const building = buildInProgress();
  return {
    schema: MANIFEST_SCHEMA,
    writtenAt: (input.at ?? new Date()).toISOString(),
    checkout: {
      worktree: REPO_ROOT,
      branch: currentBranchName(),
      commit: currentCommit(),
      primary: isPrimaryCheckout(),
    },
    app: {
      url: contract.appUrl,
      port: contract.appPort,
      serving: webPid !== null,
      pid: webPid,
    },
    stack: input.stack ?? stackFromState(contract),
    build: {
      app: 'web',
      state: classifyRecordedArtifact(),
      fingerprint: record?.fingerprint ?? null,
      builtAt: record?.builtAt ?? null,
    },
    slots: {
      busy: slots?.busy ?? null,
      cap: slots?.cap ?? null,
      waiting: slots?.waiting ?? null,
      degraded: slots?.degraded ?? false,
    },
    building:
      building === null ? null : { pid: building.pid, start: building.start, slot: building.slot },
    next: { ...NEXT_COMMANDS },
  };
}

/**
 * The stack facts a caller without an authoritative read can honestly claim.
 *
 * `.dev/stack.json` is written when a serving ensure attributes the server to a
 * stack and removed by `down --all`, so its presence is this tool's own record
 * of "a stack is up here"; `stack-cache.json` adds the id/runtime while it is
 * fresh. Both are claims, not proofs — `env status` proves and reports the
 * difference.
 */
function stackFromState(contract: Contract): ManifestStack {
  if (contract.shared) return sharedStackFacts();
  const state = readStackState();
  if (!state) return { id: null, name: null, runtime: null, running: false };
  const cached = readCachedStack(
    state.stackName === 'default' ? null : state.stackName,
    currentBranchRef(),
  );
  return {
    id: cached?.status.id ?? null,
    name: state.stackName,
    runtime: cached?.status.runtime ?? null,
    running: true,
  };
}

/**
 * Write `.dev/env.json`. Best-effort: a manifest that cannot be written is a
 * warning, never a reason for a build, serve or teardown to fail.
 */
export function writeEnvManifest(input: ManifestWriteInput = {}): void {
  try {
    ensureDevDir();
    atomicWriteFile(manifestPath(), `${JSON.stringify(buildManifest(input), null, 2)}\n`);
  } catch (error) {
    writeStderrLine(
      `warning: manifest: could not write ${MANIFEST_FILE} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}

export type ManifestRead =
  | { state: 'absent' }
  | { state: 'unreadable'; error: string }
  | { state: 'other-schema'; schema: number | null }
  | { state: 'ok'; manifest: EnvManifest };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Validate one parsed document against schema 1. A missing container is a
 * shape this version cannot read; a missing leaf reads as null (unknown), so a
 * field added later never makes an older file unreadable.
 */
function parseManifest(value: Record<string, unknown>): EnvManifest | null {
  const { checkout, app, stack, build, slots, next } = value;
  if (
    !isRecord(checkout) ||
    !isRecord(app) ||
    !isRecord(stack) ||
    !isRecord(build) ||
    !isRecord(slots) ||
    !isRecord(next)
  ) {
    return null;
  }
  const building = isRecord(value.building) ? value.building : null;
  const port = numberOrNull(app.port);
  if (port === null) return null;
  return {
    schema: MANIFEST_SCHEMA,
    writtenAt: stringOrNull(value.writtenAt) ?? '',
    checkout: {
      worktree: stringOrNull(checkout.worktree) ?? '',
      branch: stringOrNull(checkout.branch) ?? '',
      commit: stringOrNull(checkout.commit),
      primary: booleanOrNull(checkout.primary) ?? false,
    },
    app: {
      url: stringOrNull(app.url) ?? '',
      port,
      serving: booleanOrNull(app.serving) ?? false,
      pid: numberOrNull(app.pid),
    },
    stack: {
      id: stringOrNull(stack.id),
      name: stringOrNull(stack.name),
      runtime: stringOrNull(stack.runtime),
      running: booleanOrNull(stack.running) ?? false,
    },
    build: {
      app: 'web',
      state:
        build.state === 'current' ||
        build.state === 'stale' ||
        build.state === 'unrecorded' ||
        build.state === 'missing'
          ? build.state
          : null,
      fingerprint: stringOrNull(build.fingerprint),
      builtAt: stringOrNull(build.builtAt),
    },
    slots: {
      busy: numberOrNull(slots.busy),
      cap: numberOrNull(slots.cap),
      waiting: numberOrNull(slots.waiting),
      degraded: booleanOrNull(slots.degraded) ?? false,
    },
    building:
      building === null
        ? null
        : {
            pid: numberOrNull(building.pid),
            start: stringOrNull(building.start),
            slot: numberOrNull(building.slot),
          },
    next: {
      build: stringOrNull(next.build) ?? '',
      serve: stringOrNull(next.serve) ?? '',
      down: stringOrNull(next.down) ?? '',
    },
  };
}

/** Read `.dev/env.json` without throwing: absent, unreadable, other schema or a document. */
function readEnvManifest(): ManifestRead {
  const path = manifestPath();
  let raw: string;
  try {
    if (lstatSync(path).isSymbolicLink()) {
      return { state: 'unreadable', error: 'it is a symlink' };
    }
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    return {
      state: 'unreadable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: 'unreadable', error: 'it is not valid JSON' };
  }
  if (!isRecord(parsed)) return { state: 'unreadable', error: 'it is not a JSON object' };
  if (parsed.schema !== MANIFEST_SCHEMA) {
    return { state: 'other-schema', schema: numberOrNull(parsed.schema) };
  }
  const manifest = parseManifest(parsed);
  return manifest === null
    ? { state: 'unreadable', error: `it does not match schema ${MANIFEST_SCHEMA}` }
    : { state: 'ok', manifest };
}

/**
 * The live facts a manifest is judged against.
 *
 * An unobserved fact is unknown — `null` for `stackRunning`, `undefined` for the
 * id/runtime — never `true`/`false` by default: a probe that failed must not
 * turn into "the file disagrees". Deliberately not every field:
 * `slots` are machine-wide counts that move without any change to this
 * checkout, so a difference there would mark the file stale for another
 * worktree's build; `stack.name` and `build.builtAt` are identity and age, not
 * state. `writtenAt` plus the pids the file names make its age visible.
 */
export interface ManifestFacts {
  appPort: number;
  appUrl: string;
  webPid: number | null;
  /** Undefined when the stack probe failed: unknown, not "no id". */
  stackId: string | null | undefined;
  /** Null when the `supabase stack status` probe failed: unknown, not stopped. */
  stackRunning: boolean | null;
  /** Undefined when nothing observed it: unknown, not "no runtime". */
  runtime: string | null | undefined;
  buildState: BuildArtifactState | null;
  fingerprint: string | null;
  building: BuildInProgress | null;
  /** Short branch name, the form `checkout.branch` is written in. */
  branch: string | null;
  commit: string | null;
}

function show(value: string | number | boolean | null): string {
  return value === null ? 'none' : String(value);
}

function compareManifest(manifest: EnvManifest, facts: ManifestFacts): string[] {
  const differences: string[] = [];
  const note = (
    field: string,
    claimed: string | number | boolean | null,
    live: string | number | boolean | null,
  ) => {
    differences.push(`${field}: the file says ${show(claimed)}, live says ${show(live)}`);
  };

  if (manifest.app.port !== facts.appPort) note('app.port', manifest.app.port, facts.appPort);
  if (manifest.app.url !== facts.appUrl) note('app.url', manifest.app.url, facts.appUrl);
  const serving = facts.webPid !== null;
  if (manifest.app.serving !== serving) note('app.serving', manifest.app.serving, serving);
  else if (facts.webPid !== null && manifest.app.pid !== facts.webPid) {
    note('app.pid', manifest.app.pid, facts.webPid);
  }

  // A failed probe is unknown: comparing it would blame the file for #1360.
  if (facts.stackRunning !== null && manifest.stack.running !== facts.stackRunning) {
    note('stack.running', manifest.stack.running, facts.stackRunning);
  }
  // A null claim is "unknown at write time", never a disagreement — and an
  // unobserved fact (`undefined`) is equally not evidence against the file.
  if (facts.stackId !== undefined && manifest.stack.id !== null) {
    if (manifest.stack.id !== facts.stackId) note('stack.id', manifest.stack.id, facts.stackId);
  }
  if (facts.runtime !== undefined && manifest.stack.runtime !== null) {
    if (manifest.stack.runtime !== facts.runtime) {
      note('stack.runtime', manifest.stack.runtime, facts.runtime);
    }
  }

  if (manifest.build.state !== facts.buildState) {
    note('build.state', manifest.build.state, facts.buildState);
  }
  if (
    manifest.build.fingerprint !== null &&
    facts.fingerprint !== null &&
    manifest.build.fingerprint !== facts.fingerprint
  ) {
    note('build.fingerprint', manifest.build.fingerprint, facts.fingerprint);
  }

  const live = facts.building;
  if (manifest.building === null && live !== null) {
    differences.push(
      `building: the file says none, live says pid ${show(live.pid)} is building` +
        `${live.slot === null ? '' : ` (slot ${live.slot})`}`,
    );
  } else if (manifest.building !== null && live === null) {
    differences.push(
      `building: the file names pid ${show(manifest.building.pid)}` +
        `${manifest.building.slot === null ? '' : ` (slot ${manifest.building.slot})`}, live says none`,
    );
  } else if (manifest.building !== null && live !== null && manifest.building.pid !== live.pid) {
    note('building.pid', manifest.building.pid, live.pid);
  }

  // A wrong branch is actively misleading (a `git checkout -b` onto the same
  // commit leaves the commit equal), and one `git` call answers it.
  if (manifest.checkout.branch !== '' && facts.branch !== null) {
    if (manifest.checkout.branch !== facts.branch) {
      note('checkout.branch', manifest.checkout.branch, facts.branch);
    }
  }
  if (manifest.checkout.commit !== null && facts.commit !== null) {
    if (manifest.checkout.commit !== facts.commit) {
      note('checkout.commit', manifest.checkout.commit, facts.commit);
    }
  }
  return differences;
}

/**
 * Reconcile the file with the live probe. This is the authority side: status
 * reports the disagreements and never presents the file as fact.
 */
export function manifestReport(facts: ManifestFacts): ManifestReport {
  const read = readEnvManifest();
  if (read.state === 'absent') {
    return {
      present: false,
      schema: null,
      writtenAt: null,
      agrees: null,
      differences: [],
      error: null,
    };
  }
  if (read.state === 'unreadable') {
    return {
      present: true,
      schema: null,
      writtenAt: null,
      agrees: null,
      differences: [],
      error: read.error,
    };
  }
  if (read.state === 'other-schema') {
    return {
      present: true,
      schema: read.schema,
      writtenAt: null,
      agrees: false,
      differences: [`schema: the file is ${show(read.schema)}, this tool reads ${MANIFEST_SCHEMA}`],
      error: null,
    };
  }
  const { manifest } = read;
  const differences = compareManifest(manifest, facts);
  return {
    present: true,
    schema: manifest.schema,
    writtenAt: manifest.writtenAt === '' ? null : manifest.writtenAt,
    agrees: differences.length === 0,
    differences,
    error: null,
  };
}
