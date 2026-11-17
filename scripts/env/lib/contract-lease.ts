import { contractWithPort, type Contract } from './contract';
import { leaseProjectId, readLease } from './lease';
import { readRegistry } from './registry';
import { REPO_ROOT, currentBranchRef } from './repo';
import { identityKey } from './state';

/**
 * Read-only commands run without varlock, so `APP_PORT` is often unset even
 * when a stack (and its app-port lease) exists. Adopt the lease unless the
 * operator explicitly set `APP_PORT`/`APP_URL`: the stack's auth redirect URLs
 * are bound to the port it was started with.
 */
export function contractWithLease(contract: Contract): Contract {
  if (process.env.APP_PORT || process.env.APP_URL) return contract;
  const registry = readRegistry();
  // A symlinked/foreign registry must never drive the app port.
  if (!registry.trusted) return contract;
  const key = identityKey(REPO_ROOT, currentBranchRef(), contract.stackName ?? '');
  const lease = readLease(registry.dir, leaseProjectId(key));
  if (!lease?.appPort) return contract;
  return contractWithPort(contract, lease.appPort);
}

/**
 * Adopt a resolved contract for this process, so the server or build it starts
 * inherits the leased port and site URL. An operator-set `NEXT_PUBLIC_SITE_URL`
 * wins: it is inlined at build time and must not be silently replaced.
 */
export function applyContractEnv(contract: Contract): void {
  process.env.APP_PORT = String(contract.appPort);
  process.env.APP_URL = contract.appUrl;
  process.env.NEXT_PUBLIC_SITE_URL ||= contract.appUrl;
}
