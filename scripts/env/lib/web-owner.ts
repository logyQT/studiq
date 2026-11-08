import { canon, isThisCheckout } from './repo';
import { readRegistry } from './registry';
import { readLease, type AppLease } from './lease';
import { identityKey, readStackRecord } from './state';
import { readProcessEnvironment, readWebPid, readWebPort } from './web';

/**
 * Attribute the checkout's live `next start` process to the stack/profile it
 * serves. The tool intentionally manages **one environment per worktree**; the
 * data already present is enough: `.dev/web.pid`, the child's own env (written
 * by `startWebServer`), the app-port lease and the stack record.
 */
export interface LiveWebServer {
  pid: number;
  port: number | null;
  stackName: string | null;
  profile: string | null;
}

function envValue(text: string, name: string): string | null {
  const match = new RegExp(`(?:^|[\\0\\s])${name}=([^\\0\\s]*)`).exec(text);
  return match?.[1] ? match[1] : null;
}

function readLiveWebServer(): LiveWebServer | null {
  const pid = readWebPid();
  if (!pid) return null;
  const port = readWebPort(pid);
  const environment = readProcessEnvironment(pid);
  const envStack = envValue(environment, 'STUDIQ_ENV_STACK');
  const envProfile = envValue(environment, 'STUDIQ_ENV_PROFILE');

  let lease: AppLease | null = null;
  const registry = readRegistry();
  if (registry.trusted) {
    const candidates = registry.entries
      .map((entry) => readLease(registry.dir, entry.projectId))
      .filter((entry): entry is AppLease => entry !== null)
      .filter((entry) => isThisCheckout(entry.projectRoot));
    lease =
      candidates.find((entry) => entry.ownerPid === pid) ??
      (port ? candidates.find((entry) => entry.appPort === port) : undefined) ??
      null;
  }

  const stackName = envStack ?? (lease ? lease.stackName || 'default' : null);
  let profile = envProfile;
  if (!profile && lease) {
    const record = readStackRecord(
      identityKey(canon(lease.projectRoot), lease.branch, lease.stackName || ''),
    );
    profile = record?.profile ?? null;
  }

  return { pid, port, stackName, profile };
}

export interface RequestedServerTarget {
  stackName: string;
  profile: string | null;
}

/**
 * `null` when there is no live server, or it already serves the requested
 * stack/profile (same-environment handover stays legal). Otherwise a one-line
 * refusal message; an unattributable live server fails closed.
 */
export function liveServerConflict(
  requested: RequestedServerTarget,
  operation: 'start' | 'rebuild',
): string | null {
  const live = readLiveWebServer();
  if (!live) return null;
  const action = operation === 'start' ? 'start another environment' : 'rebuild apps/web/.next';
  if (!live.stackName || !live.profile) {
    return `web server pid ${live.pid} is running but its stack/profile cannot be determined; refusing to ${action} — run 'env:down' first, or use a separate worktree.`;
  }
  if (!requested.profile) {
    return `web server pid ${live.pid} (stack '${live.stackName}', profile ${live.profile}) is running and the requested profile cannot be determined; refusing to ${action} — run 'env:down' first, or use a separate worktree.`;
  }
  if (live.stackName === requested.stackName && live.profile === requested.profile) return null;
  return `web server pid ${live.pid} is serving stack '${live.stackName}' (profile ${live.profile}); refusing to ${action} for stack '${requested.stackName}' (profile ${requested.profile}) — run 'env:down' first, or use a separate worktree.`;
}
