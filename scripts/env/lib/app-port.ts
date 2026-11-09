import { EXIT_CONFLICT, EnvFailure } from './exit';
import {
  claimAppPort,
  isClaimStale,
  readAppPortClaim,
  releaseAppPortClaim,
  type AppPortClaim,
} from './lease';
import { readRegistry, type RegistryEntry } from './registry';

const APP_PORT_MIN = 3000;
const APP_PORT_MAX = 3999;
/** :3010 is the shared QA app; `scripts/dev` refuses to serve it. */
const RESERVED_APP_PORTS = new Set([3010]);

export interface AppPortCandidatesInput {
  /** The port this checkout's lease already holds, if any. */
  existingPort: number | null;
  /** The contract's `APP_PORT` (the first candidate on a cold start). */
  defaultPort: number;
  /** `--app-port`: the only candidate, and a conflict is an error. */
  explicitPort: number | null;
}

/**
 * Candidate order (spec §5): the explicit port alone, otherwise the leased
 * port, the contract port, then the rest of the app range minus the QA port.
 */
export function appPortCandidates(input: AppPortCandidatesInput): number[] {
  if (input.explicitPort) return [input.explicitPort];
  const candidates = [(input.existingPort ?? input.defaultPort) || APP_PORT_MIN];
  for (let port = APP_PORT_MIN; port <= APP_PORT_MAX; port += 1) {
    if (!RESERVED_APP_PORTS.has(port) && !candidates.includes(port)) candidates.push(port);
  }
  return candidates;
}

export interface ChooseAppPortInput {
  /** Shared registry directory. */
  dir: string;
  /** This checkout's lease project id. */
  projectId: string;
  candidates: number[];
  existingPort: number | null;
  explicitPort: number | null;
  isPortFree(port: number): Promise<boolean>;
  /**
   * Another checkout's lease holds `port`. Return true when it may be
   * reclaimed (the caller removes the stale lease); false skips the candidate.
   */
  reclaimForeign(entry: RegistryEntry, port: number): Promise<boolean>;
}

/**
 * Take the first candidate that can be reserved. The claim file is the
 * cross-checkout mutex; the lease check and the bind probe are evidence that
 * refine it (a lease written before claims existed, or a foreign process).
 * A failed claim or probe releases the candidate and moves on, so two
 * checkouts selecting at the same moment always end up on disjoint ports.
 */
export async function chooseAppPort(input: ChooseAppPortInput): Promise<number> {
  for (const port of input.candidates) {
    if (port < 1 || port > 65535 || RESERVED_APP_PORTS.has(port)) continue;

    if (!acquireClaim(input.dir, input.projectId, port)) {
      if (input.explicitPort) throw new EnvFailure(EXIT_CONFLICT, `app port ${port} is leased`);
      continue;
    }

    if (port !== input.existingPort) {
      const foreign = readRegistry(input.dir).entries.find(
        (entry) => entry.projectId !== input.projectId && entry.appPort === port,
      );
      if (foreign && !(await input.reclaimForeign(foreign, port))) {
        releaseAppPortClaim(input.dir, port, input.projectId);
        if (input.explicitPort) throw new EnvFailure(EXIT_CONFLICT, `app port ${port} is leased`);
        continue;
      }
      if (!(await input.isPortFree(port))) {
        releaseAppPortClaim(input.dir, port, input.projectId);
        if (input.explicitPort) throw new EnvFailure(EXIT_CONFLICT, `app port ${port} is in use`);
        continue;
      }
    }

    return port;
  }
  throw new EnvFailure(EXIT_CONFLICT, `no free app port in ${APP_PORT_MIN}-${APP_PORT_MAX}`);
}

/**
 * Atomic claim with one stale-claim retry: a claim whose checkout never wrote
 * a lease (crashed selector, killed process) is removed and re-claimed. A live
 * claim, or one still inside its grace period, is left alone.
 */
function acquireClaim(dir: string, projectId: string, port: number): boolean {
  if (claimAppPort(dir, port, projectId).ok) return true;
  const holder: AppPortClaim | null = readAppPortClaim(dir, port);
  if (!holder || holder.projectId === projectId || !isClaimStale(dir, holder)) return false;
  releaseAppPortClaim(dir, port, holder.projectId);
  return claimAppPort(dir, port, projectId).ok;
}
