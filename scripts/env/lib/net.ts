import { createConnection, createServer } from 'node:net';
import { entryForPort, type RegistryEntry } from './registry';

const PORT_SCAN_START = 3000;
const PORT_SCAN_END = 3999;
/** :3010 is the shared QA app; `scripts/dev` refuses to serve it. */
const RESERVED_APP_PORTS = new Set([3010]);

/** Whether something accepts a TCP connection on `127.0.0.1:<port>`. */
export function portInUse(port: number, timeoutMs = 300): Promise<boolean> {
  if (port <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (inUse: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Whether `127.0.0.1:<port>` can be bound right now. A connect probe only sees
 * a listener accepting on loopback; a wildcard or another-interface socket can
 * still make our own `listen()` fail, so port selection asks the kernel.
 * Any bind error (EADDRINUSE, EACCES, …) means the port is unusable.
 */
function canBindPort(port: number): Promise<boolean> {
  if (port <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (available: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(available);
    };
    server.once('error', () => finish(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => finish(true));
    });
  });
}

/**
 * The first free app port in `3000-3999`, mirroring `scripts/dev`'s
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
