import { EXIT_CONFLICT, EnvFailure } from './exit';
import { withClaimsLock } from './locks';
import {
  claimAppPort,
  isClaimStale,
  readAppPortClaim,
  releaseAppPortClaim,
  removeAppPortClaimIfHeldBy,
  sameClaimHolder,
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

    if (!(await acquireClaim(input, port))) {
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
 * Atomic claim. A claim whose checkout never wrote a lease (crashed selector,
 * killed process) is removed and re-claimed; a live claim is left alone — age
 * is not evidence, only a dead owner or a reused pid (different start time) is.
 *
 * A lease-backed claim is only ever reclaimed through `reclaimForeign`, which
 * re-reads the holder's lease with its heartbeat — claim age alone never
 * removes a lease a live checkout has just refreshed.
 */
async function acquireClaim(input: ChooseAppPortInput, port: number): Promise<boolean> {
  const { dir, projectId } = input;
  if (claimAppPort(dir, port, projectId).ok) return true;
  const holder: AppPortClaim | null = readAppPortClaim(dir, port);
  if (!holder || holder.projectId === projectId) return false;
  if (isClaimStale(dir, holder)) return recoverStaleClaim(dir, port, projectId, holder);
  const entry = readRegistry(dir).entries.find((item) => item.projectId === holder.projectId);
  if (!entry || !(await input.reclaimForeign(entry, port))) return false;
  return claimAppPort(dir, port, projectId).ok;
}

/**
 * Remove a stale claim and take it as one serialized unit.
 *
 * The stale path is a read → unlink → claim sequence: two recoverers can both
 * validate the dead holder, one re-claims, and the other's pending unlink
 * deletes the replacement. Under the registry-wide claims mutex the holder is
 * re-read and only removed when it is still the claim the caller saw stale;
 * if another recoverer already replaced it, this caller simply loses the race
 * and moves to the next candidate. Callers that take the lock do so even when
 * the claim vanished in between, so the `wx` claim stays the only writer.
 */
async function recoverStaleClaim(
  dir: string,
  port: number,
  projectId: string,
  observed: AppPortClaim,
): Promise<boolean> {
  return withClaimsLock(() => {
    const current = readAppPortClaim(dir, port);
    if (!current) return claimAppPort(dir, port, projectId).ok;
    if (current.projectId === projectId) return claimAppPort(dir, port, projectId).ok;
    // Only the exact observed holder may be removed; a replacement is never
    // deleted, and a claim that became live again (lease written) is kept.
    if (!sameClaimHolder(current, observed) || !isClaimStale(dir, current)) return false;
    removeAppPortClaimIfHeldBy(dir, port, current);
    return claimAppPort(dir, port, projectId).ok;
  });
}
