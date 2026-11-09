import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BUN } from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface AppPortClaim {
  projectId: string;
  appPort: number;
  ownerPid: number;
  createdAt: string;
}

interface LeaseModule {
  claimAppPort(
    dir: string,
    port: number,
    projectId: string,
    ownerPid?: number,
  ): { ok: boolean; holder: AppPortClaim | null };
  readAppPortClaim(dir: string, port: number): AppPortClaim | null;
  releaseAppPortClaim(dir: string, port: number, projectId: string): boolean;
  isClaimStale(dir: string, claim: AppPortClaim, now?: number): boolean;
  writeLease(lease: Record<string, unknown>): void;
  newLease(input: Record<string, unknown>): Record<string, unknown>;
}

interface AppPortModule {
  appPortCandidates(input: {
    existingPort: number | null;
    defaultPort: number;
    explicitPort: number | null;
  }): number[];
  chooseAppPort(input: {
    dir: string;
    projectId: string;
    candidates: number[];
    existingPort: number | null;
    explicitPort: number | null;
    isPortFree(port: number): Promise<boolean>;
    reclaimForeign(): Promise<boolean>;
  }): Promise<number>;
}

const lease = await loadEnvModule<LeaseModule>('lib/lease.ts');
const appPort = await loadEnvModule<AppPortModule>('lib/app-port.ts');

const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    const pid = child.pid;
    try {
      if (pid !== undefined) process.kill(-pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function registry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-claim-'));
  dirs.push(dir);
  return dir;
}

function leaseFiles(dir: string): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('env-') || !name.endsWith('.json')) continue;
    const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (!isRecord(parsed)) throw new Error(`${name} is not a lease object`);
    entries.push(parsed);
  }
  return entries;
}

function requireClaim(dir: string, port: number): AppPortClaim {
  const claim = lease.readAppPortClaim(dir, port);
  if (!claim) throw new Error(`no claim on port ${port}`);
  return claim;
}

function selection(stdout: string): { projectId: string; appPort: number } {
  const parsed: unknown = JSON.parse(stdout);
  if (
    !isRecord(parsed) ||
    typeof parsed.projectId !== 'string' ||
    typeof parsed.appPort !== 'number'
  ) {
    throw new Error(`unexpected selection output: ${stdout}`);
  }
  return { projectId: parsed.projectId, appPort: parsed.appPort };
}

describe('cross-checkout app-port claims (spec §5)', () => {
  it('lets exactly one checkout hold a port claim', () => {
    const dir = registry();
    expect(lease.claimAppPort(dir, 3000, 'env-alpha').ok).toBe(true);

    const denied = lease.claimAppPort(dir, 3000, 'env-beta');
    expect(denied.ok).toBe(false);
    expect(denied.holder?.projectId).toBe('env-alpha');

    // Re-entrant claims from the holder are idempotent, not a conflict.
    expect(lease.claimAppPort(dir, 3000, 'env-alpha').ok).toBe(true);
    expect(lease.readAppPortClaim(dir, 3000)?.projectId).toBe('env-alpha');

    expect(lease.releaseAppPortClaim(dir, 3000, 'env-beta')).toBe(false);
    expect(lease.readAppPortClaim(dir, 3000)?.projectId).toBe('env-alpha');
    expect(lease.releaseAppPortClaim(dir, 3000, 'env-alpha')).toBe(true);
    expect(lease.claimAppPort(dir, 3000, 'env-beta').ok).toBe(true);
  });

  it('treats a claim without a lease as stale only once its owner is gone', () => {
    const dir = registry();
    lease.claimAppPort(dir, 3100, 'env-crashed', 999_999_999);
    expect(lease.isClaimStale(dir, requireClaim(dir, 3100))).toBe(true);

    lease.claimAppPort(dir, 3101, 'env-selecting', process.pid);
    expect(lease.isClaimStale(dir, requireClaim(dir, 3101))).toBe(false);

    // A claim backed by a lease is never stolen by claim-age alone.
    const savedRegistry = process.env.STUDIQ_DEV_REGISTRY;
    process.env.STUDIQ_DEV_REGISTRY = dir;
    try {
      lease.writeLease(
        lease.newLease({
          projectId: 'env-crashed',
          projectRoot: '/checkout/crashed',
          branch: 'refs/heads/test',
          stackName: '',
          appPort: 3102,
          shared: false,
          sharedOwner: null,
          mode: 'dev',
        }),
      );
    } finally {
      if (savedRegistry === undefined) delete process.env.STUDIQ_DEV_REGISTRY;
      else process.env.STUDIQ_DEV_REGISTRY = savedRegistry;
    }
    expect(lease.isClaimStale(dir, requireClaim(dir, 3100))).toBe(false);
  });

  it('moves to the next candidate when another checkout holds the claim', async () => {
    const dir = registry();
    lease.claimAppPort(dir, 3000, 'env-other', process.pid);

    const chosen = await appPort.chooseAppPort({
      dir,
      projectId: 'env-mine',
      candidates: [3000, 3001],
      existingPort: null,
      explicitPort: null,
      isPortFree: () => Promise.resolve(true),
      reclaimForeign: () => Promise.resolve(false),
    });

    expect(chosen).toBe(3001);
    expect(lease.readAppPortClaim(dir, 3001)?.projectId).toBe('env-mine');
  });

  it('reclaims a dead claimant and keeps the port', async () => {
    const dir = registry();
    lease.claimAppPort(dir, 3000, 'env-dead', 999_999_999);

    const chosen = await appPort.chooseAppPort({
      dir,
      projectId: 'env-mine',
      candidates: [3000],
      existingPort: null,
      explicitPort: null,
      isPortFree: () => Promise.resolve(true),
      reclaimForeign: () => Promise.resolve(false),
    });

    expect(chosen).toBe(3000);
    expect(lease.readAppPortClaim(dir, 3000)?.projectId).toBe('env-mine');
  });

  it('fails an explicit port that another claim holds', async () => {
    const dir = registry();
    lease.claimAppPort(dir, 3000, 'env-other', process.pid);

    await expect(
      appPort.chooseAppPort({
        dir,
        projectId: 'env-mine',
        candidates: [3000],
        existingPort: null,
        explicitPort: 3000,
        isPortFree: () => Promise.resolve(true),
        reclaimForeign: () => Promise.resolve(false),
      }),
    ).rejects.toThrow('app port 3000 is leased');
  });

  it('two parallel selections reserve disjoint app ports and write one lease each', async () => {
    const dir = registry();
    const go = join(dir, 'go');
    const projectIds = ['env-alpha', 'env-beta', 'env-gamma'];
    const script = join(dir, 'select.ts');
    writeFileSync(
      script,
      [
        `const { chooseAppPort, appPortCandidates } = await import(${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'scripts/env/lib/app-port.ts')).href)});`,
        `const lease = await import(${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'scripts/env/lib/lease.ts')).href)});`,
        `const { probePortBind } = await import(${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'scripts/env/lib/net.ts')).href)});`,
        `const fs = await import('node:fs');`,
        `const [projectId, worktree, go] = process.argv.slice(2);`,
        `while (!fs.existsSync(go)) await new Promise((done) => setTimeout(done, 5));`,
        `const port = await chooseAppPort({`,
        `  dir: process.env.STUDIQ_DEV_REGISTRY,`,
        `  projectId,`,
        `  candidates: appPortCandidates({ existingPort: null, defaultPort: 3000, explicitPort: null }),`,
        `  existingPort: null,`,
        `  explicitPort: null,`,
        `  isPortFree: async (candidate) => (await probePortBind(candidate)).state === 'free',`,
        `  reclaimForeign: async () => false,`,
        `});`,
        `lease.writeLease(lease.newLease({ projectId, projectRoot: worktree, branch: 'refs/heads/test', stackName: projectId, appPort: port, shared: false, sharedOwner: null, mode: 'dev' }));`,
        `console.log(JSON.stringify({ projectId, appPort: port }));`,
        '',
      ].join('\n'),
    );

    const run = (
      projectId: string,
    ): Promise<{ code: number | null; stdout: string; stderr: string }> =>
      new Promise((resolve) => {
        const child = spawn(BUN, [script, projectId, `/checkout/${projectId}`, go], {
          env: {
            ...process.env,
            STUDIQ_DEV_REGISTRY: dir,
          },
          detached: true,
        });
        children.push(child);
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer | string) => {
          stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
          stderr += String(chunk);
        });
        child.on('error', (error) => resolve({ code: null, stdout, stderr: error.message }));
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      });

    // Release every child at once so they all race for the same first candidate.
    const pending = projectIds.map((projectId) => run(projectId));
    writeFileSync(go, 'go\n');
    const results = await Promise.all(pending);
    for (const result of results) expect(result.code, result.stderr).toBe(0);

    const selected = results.map((result) => selection(result.stdout));
    const ports = selected.map((entry) => entry.appPort);
    expect(new Set(ports).size).toBe(ports.length);

    const leases = leaseFiles(dir);
    expect(leases).toHaveLength(projectIds.length);
    const leasedPorts = leases.map((entry) => entry.appPort);
    expect(new Set(leasedPorts).size).toBe(leasedPorts.length);
    for (const entry of selected) {
      expect(leases.find((item) => item.projectId === entry.projectId)?.appPort).toBe(
        entry.appPort,
      );
      expect(lease.readAppPortClaim(dir, entry.appPort)?.projectId).toBe(entry.projectId);
    }
  });
});
