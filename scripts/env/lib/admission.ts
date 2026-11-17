import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_USAGE, EnvFailure } from './exit';
import { readRegistry, type RegistryEntry } from './registry';
import { REPO_ROOT, canon } from './repo';
import { DEV_DIR, readStackState, type StackState } from './state';

/**
 * Build admission (ADR-0014, decision 5): how many `next build`s this box can
 * take right now.
 *
 * The decision is a pure function of a memory reading, the live slot count and
 * the stack reserve, so the arithmetic is tested without a box of any particular
 * size. The probes are the only I/O, and a probe that cannot answer fails
 * **open**: the cap becomes exactly one, never zero. A host reading inside a
 * limited sandbox is the failure this module exists to prevent, so the cgroup
 * limit, when there is one, always wins over the host's `MemAvailable`.
 */

const GIB = 1024 ** 3;

/**
 * One build's measured peak RSS (Evidence §4: 3.93 GB across 18 processes).
 *
 * @public Read by the unit tests, which load this module by computed URL.
 */
export const SLOT_RSS_BYTES = 3.9 * GIB;
/**
 * Headroom kept free after every admitted build's reservation (a target).
 *
 * @public Read by the unit tests, which load this module by computed URL.
 */
export const MIN_FREE_BYTES = 4.5 * GIB;
/**
 * The ceiling until Open Question 1 is measured; memory may lower it, never raise it.
 *
 * @public Read by the unit tests, which load this module by computed URL.
 */
export const SLOT_CEILING = 3;

const MEMINFO = '/proc/meminfo';
const CGROUP_V2_MAX = '/sys/fs/cgroup/memory.max';
const CGROUP_V2_CURRENT = '/sys/fs/cgroup/memory.current';
const CGROUP_V1_MAX = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
const CGROUP_V1_CURRENT = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
/** This checkout's last observed stack, read for its runtime only (no CLI call). */
const STACK_CACHE = join(DEV_DIR, 'stack-cache.json');

export interface MemoryReading {
  /** `min(MemTotal, cgroup max)`; null when the probe failed. */
  capacityBytes: number | null;
  /** `min(MemAvailable, cgroup max − current)`; null when the probe failed. */
  freeBytes: number | null;
  /** No cgroup limit exists, so the host reading is the whole measurement. */
  hostFallback: boolean;
  /** Why the probe failed, naming the platform and the missing input; else null. */
  detail: string | null;
}

export interface MemoryProbeDeps {
  /** Test seam: the platform whose probe runs. */
  platform?: NodeJS.Platform;
  /** Test seam: file reads, so v1/v2/`max`/missing inputs are simulable. */
  readFile?(path: string): string | null;
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** `MemTotal: 20479644 kB` → bytes. A missing, unparseable or zero value is null. */
function kib(text: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s+(\\d+)\\s+kB\\s*$`, 'm').exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value * 1024 : null;
}

type LimitRead =
  | { kind: 'limit'; bytes: number }
  /** `max` on v2, or the v1 sentinel (a value at or above physical RAM). */
  | { kind: 'unlimited' }
  | { kind: 'absent' };

function readLimit(text: string | null, totalBytes: number): LimitRead {
  if (text === null) return { kind: 'absent' };
  const trimmed = text.trim();
  if (trimmed === 'max') return { kind: 'unlimited' };
  if (!/^\d+$/.test(trimmed)) return { kind: 'absent' };
  const bytes = Number(trimmed);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes >= totalBytes) {
    return { kind: 'unlimited' };
  }
  return { kind: 'limit', bytes };
}

function readUsage(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const bytes = Number(trimmed);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

type CgroupRead =
  | { kind: 'none' }
  | { kind: 'limit'; maxBytes: number; currentBytes: number }
  /** A limit exists but its usage cannot be read: fall back to the cap of one. */
  | { kind: 'broken'; detail: string };

function readCgroupLimit(read: (path: string) => string | null, totalBytes: number): CgroupRead {
  const v2 = readLimit(read(CGROUP_V2_MAX), totalBytes);
  if (v2.kind === 'limit') {
    const current = readUsage(read(CGROUP_V2_CURRENT));
    if (current === null) return { kind: 'broken', detail: `cannot read ${CGROUP_V2_CURRENT}` };
    return { kind: 'limit', maxBytes: v2.bytes, currentBytes: current };
  }
  if (v2.kind === 'unlimited') return { kind: 'none' };
  const v1 = readLimit(read(CGROUP_V1_MAX), totalBytes);
  if (v1.kind !== 'limit') return { kind: 'none' };
  const current = readUsage(read(CGROUP_V1_CURRENT));
  if (current === null) return { kind: 'broken', detail: `cannot read ${CGROUP_V1_CURRENT}` };
  return { kind: 'limit', maxBytes: v1.bytes, currentBytes: current };
}

function degraded(platform: string, detail: string): MemoryReading {
  return {
    capacityBytes: null,
    freeBytes: null,
    hostFallback: false,
    detail: `cannot measure memory on ${platform}: ${detail}`,
  };
}

/**
 * Probe the memory the next build may use.
 *
 * Linux only: `/proc/meminfo` plus cgroup v2 (`memory.max`/`memory.current`) or
 * v1 (`memory.limit_in_bytes`/`memory.usage_in_bytes`). macOS's `vm_stat`
 * approximation is not implemented, so a non-Linux host reports a failed probe
 * and runs with the cap of one — the same serialization it has today.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function probeMemory(deps: MemoryProbeDeps = {}): MemoryReading {
  const platform = deps.platform ?? process.platform;
  const read = deps.readFile ?? readTextFile;
  if (platform !== 'linux') {
    return degraded(platform, `no ${platform} memory probe (Linux /proc/meminfo and cgroups only)`);
  }
  const meminfo = read(MEMINFO);
  const total = meminfo === null ? null : kib(meminfo, 'MemTotal');
  const available = meminfo === null ? null : kib(meminfo, 'MemAvailable');
  if (total === null || available === null) {
    return degraded(platform, `cannot read ${MEMINFO} (MemTotal/MemAvailable)`);
  }
  const cgroup = readCgroupLimit(read, total);
  if (cgroup.kind === 'broken') return degraded(platform, cgroup.detail);
  if (cgroup.kind === 'none') {
    return { capacityBytes: total, freeBytes: available, hostFallback: true, detail: null };
  }
  const free = Math.min(available, cgroup.maxBytes - cgroup.currentBytes);
  if (free <= 0) return degraded(platform, 'the cgroup has no memory headroom left');
  return {
    capacityBytes: Math.min(total, cgroup.maxBytes),
    freeBytes: free,
    hostFallback: false,
    detail: null,
  };
}

/**
 * The memory floor, from `STUDIQ_BUILD_MIN_FREE_MB` (0 disables the test).
 *
 * A malformed value is a usage error rather than a silent default: a knob that
 * looks set and does nothing is worse than a build that refuses to start.
 */
export function minFreeBytes(): number {
  const raw = process.env.STUDIQ_BUILD_MIN_FREE_MB;
  if (raw === undefined || raw === '') return MIN_FREE_BYTES;
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb < 0) {
    throw new EnvFailure(
      EXIT_USAGE,
      `STUDIQ_BUILD_MIN_FREE_MB='${raw}' is not a non-negative number`,
    );
  }
  return mb * 1024 * 1024;
}

export type AdmissionReason =
  /** The reservation and the free-memory floor both hold. */
  | 'memory'
  /** No build is active and the test failed: one build is always admitted. */
  | 'always-one'
  | 'disabled'
  /** The memory probe failed; the cap is clamped to one. */
  | 'degraded'
  | 'capacity'
  | 'free';

export interface AdmissionDecision {
  admit: boolean;
  /** The cap recorded for status: at least 1, because one build is always admitted. */
  cap: number;
  reason: AdmissionReason;
}

/**
 * The largest number of concurrent builds the byte capacity supports.
 *
 * `n × SLOT_RSS + stackReserve + MIN_FREE <= capacity`. On the 19.9 GB
 * benchmark box that is 3 (3 × 3.9 + 4.5 = 16.2 GB) and never 4
 * (4 × 3.9 + 4.5 = 20.1 GB).
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function slotCap(capacityBytes: number, stackReserveBytes: number, minFree: number): number {
  if (minFree <= 0) return SLOT_CEILING;
  let cap = 0;
  for (let slots = 1; slots <= SLOT_CEILING; slots += 1) {
    if (capacityBytes - (slots * SLOT_RSS_BYTES + stackReserveBytes) >= minFree) cap = slots;
  }
  return cap;
}

/**
 * Decide one admission. `activeSlots` counts the builds already holding a slot;
 * the candidate counts as one more.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function decideAdmission(input: {
  activeSlots: number;
  capacityBytes: number | null;
  freeBytes: number | null;
  stackReserveBytes: number;
  minFreeBytes: number;
}): AdmissionDecision {
  if (input.capacityBytes === null || input.freeBytes === null) {
    return { admit: input.activeSlots < 1, cap: 1, reason: 'degraded' };
  }
  if (input.minFreeBytes <= 0) {
    return { admit: true, cap: SLOT_CEILING, reason: 'disabled' };
  }
  const cap = Math.max(
    1,
    slotCap(input.capacityBytes, input.stackReserveBytes, input.minFreeBytes),
  );
  const reserved = (input.activeSlots + 1) * SLOT_RSS_BYTES + input.stackReserveBytes;
  const capacityOk = input.capacityBytes - reserved >= input.minFreeBytes;
  const freeOk = input.freeBytes >= input.minFreeBytes;
  if (capacityOk && freeOk) return { admit: true, cap, reason: 'memory' };
  if (input.activeSlots === 0) return { admit: true, cap, reason: 'always-one' };
  return { admit: false, cap, reason: capacityOk ? 'free' : 'capacity' };
}

export interface StackReserve {
  /** `projectRoot + stack name`: the ADR-0011 stack identity, not the CLI's id. */
  key: string;
  runtime: 'native' | 'docker';
}

/**
 * The stacks this box is already running memory for, de-duplicated.
 *
 * The registry's stack records (the per-checkout leases) and this checkout's
 * `.dev/stack.json` describe the same stack from two sides, so they are merged
 * on the ADR-0011 identity. A record counts while its heartbeat is inside its
 * own TTL: `down --all` removes it (freeing the reserve at the next tick), and a
 * crashed owner's record ages out within the lease TTL — conservative, never
 * optimistic. No `supabase status` call is made here.
 *
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function detectStacks(input: {
  entries: RegistryEntry[];
  local: StackState | null;
  localRuntime?: string | null;
  nowMs?: number;
}): StackReserve[] {
  const now = input.nowMs ?? Date.now();
  const stacks = new Map<string, StackReserve>();
  for (const entry of input.entries) {
    if (!recordFresh(entry, now)) continue;
    const root = canon(entry.projectRoot || entry.worktree);
    if (!root) continue;
    const key = `${root}\0${entry.stackName || 'default'}`;
    stacks.set(key, { key, runtime: entry.runtime === 'docker' ? 'docker' : 'native' });
  }
  if (input.local) {
    const key = `${REPO_ROOT}\0${input.local.stackName || 'default'}`;
    if (!stacks.has(key)) {
      stacks.set(key, {
        key,
        runtime: input.localRuntime === 'docker' ? 'docker' : 'native',
      });
    }
  }
  return [...stacks.values()];
}

function recordFresh(entry: RegistryEntry, now: number): boolean {
  const heartbeat = Date.parse(entry.heartbeatAt);
  if (!Number.isFinite(heartbeat)) return false;
  const ttlMs = (entry.ttlSec > 0 ? entry.ttlSec : 900) * 1000;
  return now - heartbeat <= ttlMs;
}

/** A native stack reserves one slot; Docker reserves two (the VM sits outside the reading). */
export function stackReserveBytes(stacks: StackReserve[]): number {
  return stacks.reduce(
    (total, stack) => total + (stack.runtime === 'docker' ? 2 : 1) * SLOT_RSS_BYTES,
    0,
  );
}

function readLocalStackRuntime(): string | null {
  const text = readTextFile(STACK_CACHE);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return null;
    const status = (parsed as { status?: unknown }).status;
    if (status === null || typeof status !== 'object') return null;
    const runtime = (status as { runtime?: unknown }).runtime;
    return typeof runtime === 'string' ? runtime : null;
  } catch {
    return null;
  }
}

/** The live stack reserve for this machine, read from files only. */
export function readStackReserve(nowMs?: number): StackReserve[] {
  return detectStacks({
    entries: readRegistry().entries,
    local: readStackState(),
    localRuntime: readLocalStackRuntime(),
    nowMs,
  });
}

/** `16.2 GB` for a warning line; binary units, labelled the way the ADR does. */
export function formatGb(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GB`;
}
