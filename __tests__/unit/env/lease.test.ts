import { describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface Lease {
  projectId: string;
  appPort: number;
  heartbeatAt: string;
  ttlSec: number;
  [key: string]: unknown;
}

interface LeaseModule {
  LEASE_TTL_SEC: number;
  isLeaseReclaimable(input: {
    pidAlive: boolean;
    heartbeatAgeMs: number;
    ttlSec: number;
    stackRunning: boolean;
  }): boolean;
  heartbeatAgeMs(lease: Lease, now?: number): number;
  leaseMatchesIdentity(
    lease: Lease,
    identity: { projectRoot: string; branch: string; stackName: string },
  ): boolean;
  leaseProjectId(identityKey: string): string;
  newLease(input: {
    projectId: string;
    projectRoot: string;
    branch: string;
    stackName: string;
    appPort: number;
    shared: boolean;
    sharedOwner: string | null;
    mode: 'dev' | 'prod';
  }): Lease;
  touchLease(lease: Lease, updates?: Partial<Lease>): Lease;
}

const lease = await loadEnvModule<LeaseModule>('lib/lease.ts');

const identity = {
  projectRoot: '/checkout',
  branch: 'refs/heads/feat/x',
  stackName: '',
};

function record(overrides: Partial<Lease> = {}): Lease {
  return {
    projectId: 'env-abc',
    appPort: 3000,
    heartbeatAt: new Date(0).toISOString(),
    ttlSec: lease.LEASE_TTL_SEC,
    projectRoot: identity.projectRoot,
    branch: identity.branch,
    stackName: identity.stackName,
    ...overrides,
  };
}

describe('app-port lease math (spec §5.2, §6.1)', () => {
  it('reclaims only when the pid is dead, the heartbeat is old and no stack runs', () => {
    const base = {
      pidAlive: false,
      heartbeatAgeMs: 16 * 60 * 1000,
      ttlSec: 15 * 60,
      stackRunning: false,
    };
    expect(lease.isLeaseReclaimable(base)).toBe(true);
    expect(lease.isLeaseReclaimable({ ...base, pidAlive: true })).toBe(false);
    expect(lease.isLeaseReclaimable({ ...base, heartbeatAgeMs: 60_000 })).toBe(false);
    expect(lease.isLeaseReclaimable({ ...base, stackRunning: true })).toBe(false);
    expect(lease.isLeaseReclaimable({ ...base, heartbeatAgeMs: 15 * 60 * 1000 })).toBe(false);
  });

  it('measures the heartbeat age and treats an invalid timestamp as infinite', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(lease.heartbeatAgeMs(record({ heartbeatAt: '2026-11-08T11:59:00Z' }), now)).toBe(60_000);
    expect(lease.heartbeatAgeMs(record({ heartbeatAt: 'not-a-date' }), now)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('matches a lease by the CLI identity (root + branch + stack name)', () => {
    expect(lease.leaseMatchesIdentity(record(), identity)).toBe(true);
    expect(lease.leaseMatchesIdentity(record({ stackName: 'named' }), identity)).toBe(false);
    expect(lease.leaseMatchesIdentity(record({ branch: 'refs/heads/other' }), identity)).toBe(
      false,
    );
  });

  it('produces a registry-compatible, secret-free lease record', () => {
    const created = lease.newLease({
      projectId: lease.leaseProjectId('0123456789abcdef'),
      projectRoot: '/checkout',
      branch: 'refs/heads/feat/x',
      stackName: '',
      appPort: 3011,
      shared: false,
      sharedOwner: null,
      mode: 'prod',
    });
    expect(created.projectId).toBe('env-0123456789abcdef');
    expect(created.appPort).toBe(3011);
    expect(created.shared).toBe(false);
    expect(JSON.stringify(created)).not.toMatch(/ANON_KEY|SERVICE_ROLE_KEY|PASSWORD|SECRET/);

    const touched = lease.touchLease(created, { appPort: 3012 });
    expect(touched.appPort).toBe(3012);
    expect(touched.projectId).toBe(created.projectId);
    expect(Date.parse(touched.heartbeatAt)).toBeGreaterThanOrEqual(Date.parse(created.heartbeatAt));
  });
});
