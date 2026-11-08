import { contractWithPort, type Contract } from './contract';
import { leaseProjectId, readLease } from './lease';
import { resolveRegistryDir } from './registry';
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
  const key = identityKey(REPO_ROOT, currentBranchRef(), contract.stackName ?? '');
  const lease = readLease(resolveRegistryDir(), leaseProjectId(key));
  if (!lease?.appPort) return contract;
  return contractWithPort(contract, lease.appPort);
}
