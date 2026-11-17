import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

interface MemoryReading {
  capacityBytes: number | null;
  freeBytes: number | null;
  hostFallback: boolean;
  detail: string | null;
}

interface AdmissionDecision {
  admit: boolean;
  cap: number;
  reason: string;
}

interface StackReserve {
  key: string;
  runtime: 'native' | 'docker';
}

interface RegistryEntry {
  projectId: string;
  worktree: string;
  projectRoot: string;
  stackName: string;
  heartbeatAt: string;
  ttlSec: number;
  runtime: string | null;
}

interface AdmissionModule {
  SLOT_RSS_BYTES: number;
  MIN_FREE_BYTES: number;
  SLOT_CEILING: number;
  probeMemory(deps?: {
    platform?: NodeJS.Platform;
    readFile?(path: string): string | null;
  }): MemoryReading;
  minFreeBytes(): number;
  slotCap(capacityBytes: number, stackReserveBytes: number, minFree: number): number;
  decideAdmission(input: {
    activeSlots: number;
    capacityBytes: number | null;
    freeBytes: number | null;
    stackReserveBytes: number;
    minFreeBytes: number;
  }): AdmissionDecision;
  detectStacks(input: {
    entries: RegistryEntry[];
    local: { stackName: string } | null;
    localRuntime?: string | null;
    nowMs?: number;
  }): StackReserve[];
  stackReserveBytes(stacks: StackReserve[]): number;
}

// `state.ts` captures DEV_DIR at import time; keep the suite off the real `.dev/`.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-env-admission-'));
const savedStateDir = process.env.STUDIQ_ENV_STATE_DIR;
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
const admission = await loadEnvModule<AdmissionModule>('lib/admission.ts');

const GIB = 1024 ** 3;
/** The benchmark box in Evidence §4: 19.9 GB of RAM. */
const BENCHMARK_BYTES = 19.9 * GIB;
const savedMinFree = process.env.STUDIQ_BUILD_MIN_FREE_MB;

afterAll(() => {
  if (savedStateDir === undefined) delete process.env.STUDIQ_ENV_STATE_DIR;
  else process.env.STUDIQ_ENV_STATE_DIR = savedStateDir;
  rmSync(stateDir, { recursive: true, force: true });
});

afterEach(() => {
  if (savedMinFree === undefined) delete process.env.STUDIQ_BUILD_MIN_FREE_MB;
  else process.env.STUDIQ_BUILD_MIN_FREE_MB = savedMinFree;
});

function decide(
  activeSlots: number,
  overrides: Partial<{
    capacityBytes: number | null;
    freeBytes: number | null;
    stackReserveBytes: number;
    minFreeBytes: number;
  }> = {},
): AdmissionDecision {
  return admission.decideAdmission({
    activeSlots,
    capacityBytes: BENCHMARK_BYTES,
    freeBytes: 15 * GIB,
    stackReserveBytes: 0,
    minFreeBytes: admission.MIN_FREE_BYTES,
    ...overrides,
  });
}

function meminfo(totalKb: number, availableKb: number): string {
  return `MemTotal:       ${totalKb} kB\nMemFree:        1000 kB\nMemAvailable:   ${availableKb} kB\n`;
}

/** A probe over a fixed file map, so v1/v2/`max`/missing inputs are simulable. */
function probe(files: Record<string, string>, platform: NodeJS.Platform = 'linux') {
  return admission.probeMemory({
    platform,
    readFile: (path) => files[path] ?? null,
  });
}

function entry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    projectId: 'env-fixture',
    worktree: REPO_ROOT,
    projectRoot: REPO_ROOT,
    stackName: '',
    heartbeatAt: new Date().toISOString(),
    ttlSec: 900,
    runtime: null,
    ...overrides,
  };
}

describe('build admission arithmetic', () => {
  it('admits three builds on the 19.9 GB benchmark box and refuses a fourth', () => {
    // The ADR's numbers, pinned: 3 × 3.9 + 4.5 = 16.2 GB fits, 4 × 3.9 + 4.5 = 20.1 GB does not.
    expect(3 * admission.SLOT_RSS_BYTES + admission.MIN_FREE_BYTES).toBeLessThanOrEqual(
      BENCHMARK_BYTES,
    );
    expect(4 * admission.SLOT_RSS_BYTES + admission.MIN_FREE_BYTES).toBeGreaterThan(
      BENCHMARK_BYTES,
    );

    expect(decide(0)).toMatchObject({ admit: true, cap: 3 });
    expect(decide(1)).toMatchObject({ admit: true, cap: 3 });
    expect(decide(2)).toMatchObject({ admit: true, cap: 3 });
    expect(decide(3)).toMatchObject({ admit: false, cap: 3, reason: 'capacity' });
  });

  it('never raises the cap above the ceiling, however much memory the box has', () => {
    expect(admission.SLOT_CEILING).toBe(3);
    expect(admission.slotCap(512 * GIB, 0, admission.MIN_FREE_BYTES)).toBe(3);
  });

  it('lowers the cap by the stack reserve', () => {
    // One native stack reserves a slot: two builds fit, a third does not.
    const reserve = admission.SLOT_RSS_BYTES;
    expect(decide(0, { stackReserveBytes: reserve })).toMatchObject({ admit: true, cap: 2 });
    expect(decide(1, { stackReserveBytes: reserve })).toMatchObject({ admit: true, cap: 2 });
    expect(decide(2, { stackReserveBytes: reserve })).toMatchObject({
      admit: false,
      cap: 2,
      reason: 'capacity',
    });
  });

  it('refuses on free memory while another build runs, and admits one when none does', () => {
    const tight = { freeBytes: 3 * GIB };
    expect(decide(1, tight)).toMatchObject({ admit: false, reason: 'free' });
    // Always-one: a box under pressure can still run the build needed to fix it.
    expect(decide(0, tight)).toMatchObject({ admit: true, reason: 'always-one' });
  });

  it('clamps the cap to one when the memory probe failed', () => {
    const failed = { capacityBytes: null, freeBytes: null };
    expect(decide(0, failed)).toMatchObject({ admit: true, cap: 1, reason: 'degraded' });
    expect(decide(1, failed)).toMatchObject({ admit: false, cap: 1, reason: 'degraded' });
  });

  it('disables the memory test entirely when the floor is zero', () => {
    process.env.STUDIQ_BUILD_MIN_FREE_MB = '0';
    expect(admission.minFreeBytes()).toBe(0);
    // The ceiling still bounds it: only the memory floor is removed.
    expect(decide(0, { capacityBytes: GIB, freeBytes: 0, minFreeBytes: 0 })).toMatchObject({
      admit: true,
      cap: admission.SLOT_CEILING,
      reason: 'disabled',
    });
  });

  it('reads the floor from STUDIQ_BUILD_MIN_FREE_MB in MB', () => {
    process.env.STUDIQ_BUILD_MIN_FREE_MB = '1024';
    expect(admission.minFreeBytes()).toBe(1024 * 1024 * 1024);
    process.env.STUDIQ_BUILD_MIN_FREE_MB = 'nonsense';
    expect(() => admission.minFreeBytes()).toThrow(/STUDIQ_BUILD_MIN_FREE_MB/);
  });
});

describe('memory probe', () => {
  it('takes the smaller of MemAvailable and the cgroup headroom (v2)', () => {
    const reading = probe({
      '/proc/meminfo': meminfo(20 * 1024 * 1024, 16 * 1024 * 1024),
      '/sys/fs/cgroup/memory.max': `${8 * GIB}\n`,
      '/sys/fs/cgroup/memory.current': `${2 * GIB}\n`,
    });
    expect(reading).toEqual({
      capacityBytes: 8 * GIB,
      freeBytes: 6 * GIB,
      hostFallback: false,
      detail: null,
    });
  });

  it('falls back to the host reading when memory.max is `max`', () => {
    const reading = probe({
      '/proc/meminfo': meminfo(20 * 1024 * 1024, 16 * 1024 * 1024),
      '/sys/fs/cgroup/memory.max': 'max\n',
      '/sys/fs/cgroup/memory.current': `${2 * GIB}\n`,
    });
    expect(reading).toEqual({
      capacityBytes: 20 * 1024 * 1024 * 1024,
      freeBytes: 16 * 1024 * 1024 * 1024,
      hostFallback: true,
      detail: null,
    });
  });

  it('reads cgroup v1 when v2 is absent', () => {
    const reading = probe({
      '/proc/meminfo': meminfo(20 * 1024 * 1024, 16 * 1024 * 1024),
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': `${10 * GIB}\n`,
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': `${1 * GIB}\n`,
    });
    expect(reading).toMatchObject({ capacityBytes: 10 * GIB, freeBytes: 9 * GIB });
    expect(reading.hostFallback).toBe(false);
  });

  it('treats the v1 no-limit sentinel as unlimited, not as headroom', () => {
    const reading = probe({
      '/proc/meminfo': meminfo(20 * 1024 * 1024, 16 * 1024 * 1024),
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712\n',
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': `${1 * GIB}\n`,
    });
    expect(reading.hostFallback).toBe(true);
    expect(reading.freeBytes).toBe(16 * 1024 * 1024 * 1024);
  });

  it('fails open, naming the platform and the missing input', () => {
    const missing = probe({});
    expect(missing.capacityBytes).toBeNull();
    expect(missing.detail).toContain('linux');
    expect(missing.detail).toContain('/proc/meminfo');

    const mac = probe({}, 'darwin');
    expect(mac.detail).toContain('darwin');

    const noUsage = probe({
      '/proc/meminfo': meminfo(20 * 1024 * 1024, 16 * 1024 * 1024),
      '/sys/fs/cgroup/memory.max': `${8 * GIB}\n`,
    });
    expect(noUsage.capacityBytes).toBeNull();
    expect(noUsage.detail).toContain('/sys/fs/cgroup/memory.current');
  });

  it('treats a cgroup with no headroom left as a failed probe', () => {
    const reading = probe({
      '/proc/meminfo': meminfo(20 * 1024 * 1024, 16 * 1024 * 1024),
      '/sys/fs/cgroup/memory.max': `${8 * GIB}\n`,
      '/sys/fs/cgroup/memory.current': `${8 * GIB}\n`,
    });
    expect(reading.capacityBytes).toBeNull();
    expect(reading.detail).toContain('headroom');
  });
});

describe('stack reserve', () => {
  it('counts one stack once, from the registry record and .dev/stack.json together', () => {
    const stacks = admission.detectStacks({
      entries: [entry({ projectId: 'env-a', stackName: '' })],
      local: { stackName: 'default' },
    });
    expect(stacks).toEqual([{ key: `${REPO_ROOT}\0default`, runtime: 'native' }]);
  });

  it('ignores a stack record whose heartbeat outlived its TTL', () => {
    const stale = new Date(Date.now() - 3_600_000).toISOString();
    const stacks = admission.detectStacks({
      entries: [entry({ projectId: 'env-old', heartbeatAt: stale, ttlSec: 900 })],
      local: null,
    });
    expect(stacks).toEqual([]);
  });

  it('reserves two slots for a Docker stack and one for a native one', () => {
    const docker: StackReserve[] = [{ key: 'a', runtime: 'docker' }];
    const native: StackReserve[] = [{ key: 'b', runtime: 'native' }];
    expect(admission.stackReserveBytes(docker)).toBe(2 * admission.SLOT_RSS_BYTES);
    expect(admission.stackReserveBytes(native)).toBe(admission.SLOT_RSS_BYTES);
    expect(admission.stackReserveBytes([])).toBe(0);
  });

  it('takes the runtime from the record when it carries one', () => {
    const stacks = admission.detectStacks({
      entries: [entry({ projectId: 'env-docker', runtime: 'docker' })],
      local: null,
    });
    expect(stacks).toEqual([{ key: `${REPO_ROOT}\0default`, runtime: 'docker' }]);
  });
});
