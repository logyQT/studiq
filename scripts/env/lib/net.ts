import { createConnection, createServer } from 'node:net';
import { entryForPort, type RegistryEntry } from './registry';

const PORT_SCAN_START = 3000;
const PORT_SCAN_END = 3999;
/** :3010 is the shared QA app; the legacy dev script refuses to serve it. */
const RESERVED_APP_PORTS = new Set([3010]);

export type PortBindState = 'free' | 'in-use' | 'unavailable';

export interface PortBindProbe {
  state: PortBindState;
  /** Errcode (or message) for `in-use`/`unavailable`; null when `free`. */
  error: string | null;
}

function errnoCode(error: Error): string | null {
  if (!('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

/**
 * Bind the app's listening address (`0.0.0.0`) and report *why* it failed.
 *
 * A connect probe to `127.0.0.1` only sees a loopback listener; a socket bound
 * on any other interface (or a full backlog) keeps `next start` from binding
 * the wildcard even though loopback still accepts a bind. Binding the wildcard
 * asks the kernel the question that matters.
 *
 * `EADDRINUSE` means another process owns the port; every other bind error
 * (`EACCES` on a privileged port, `EADDRNOTAVAIL`, …) means this machine cannot
 * use the port at all — a different situation that callers must not report as
 * a conflict.
 */
export function probePortBind(port: number): Promise<PortBindProbe> {
  if (port <= 0) return Promise.resolve({ state: 'unavailable', error: 'port out of range' });
  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (result: PortBindProbe): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    server.once('error', (error: Error) => {
      const code = errnoCode(error);
      finish({
        state: code === 'EADDRINUSE' ? 'in-use' : 'unavailable',
        error: code ?? error.message,
      });
    });
    server.listen(port, '0.0.0.0', () => {
      server.close(() => finish({ state: 'free', error: null }));
    });
  });
}

async function canBindPort(port: number): Promise<boolean> {
  return (await probePortBind(port)).state === 'free';
}

/**
 * Whether something is accepting TCP connections on `host:port`.
 *
 * This is a **liveness** probe (a service is up and listening), deliberately
 * different from `canBindPort` (whether this checkout could bind the port for
 * a new server). Do not use it for app-port selection.
 */
export function portAcceptsConnections(
  port: number,
  host = '127.0.0.1',
  timeoutMs = 300,
): Promise<boolean> {
  if (port <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (accepts: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(accepts);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * The first free app port in `3000-3999`, mirroring the legacy dev script's
 * `suggest_free_app_port`: skip the reserved QA port, ports this checkout
 * cannot bind, and ports another checkout has claimed in the registry.
 * Read-only: no lease is written (that is phase 2/4).
 */
export async function suggestFreeAppPort(entries: RegistryEntry[]): Promise<number> {
  const candidates: number[] = [];
  for (let port = PORT_SCAN_START; port <= PORT_SCAN_END; port += 1) {
    if (RESERVED_APP_PORTS.has(port)) continue;
    if (entryForPort(entries, port)) continue;
    candidates.push(port);
  }

  // Probe in batches so a slow bind cannot serialise the whole scan.
  const BATCH = 64;
  for (let offset = 0; offset < candidates.length; offset += BATCH) {
    const batch = candidates.slice(offset, offset + BATCH);
    const states = await Promise.all(batch.map((port) => canBindPort(port)));
    const freeIndex = states.indexOf(true);
    if (freeIndex !== -1) return batch[freeIndex] as number;
  }

  throw new Error(`no free APP_PORT found in ${PORT_SCAN_START}-${PORT_SCAN_END}`);
}
