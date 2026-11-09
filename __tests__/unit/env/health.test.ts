import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { startHttpServer } from '#test/unit/env/support';

// `scripts/` has no path alias and `__tests__` bans relative module specifiers,
// so the module under test is loaded by absolute file URL.
type ProbeHttp = (url: string, timeoutMs?: number) => Promise<number>;

function probeHttpFrom(module: unknown): ProbeHttp {
  if (typeof module !== 'object' || module === null || !('probeHttp' in module)) {
    throw new Error('scripts/env/lib/health does not export probeHttp');
  }
  const candidate = module.probeHttp;
  if (typeof candidate !== 'function') {
    throw new Error('probeHttp is not a function');
  }
  return (url, timeoutMs) => {
    const result: unknown = Reflect.apply(candidate, undefined, [url, timeoutMs]);
    if (!(result instanceof Promise)) throw new Error('probeHttp did not return a promise');
    return result.then((value: unknown) => {
      if (typeof value !== 'number') throw new Error('probeHttp did not resolve a number');
      return value;
    });
  };
}

const healthModule: unknown = await import(
  fileURLToPath(new URL('../../../scripts/env/lib/health.ts', import.meta.url))
);
const probeHttp = probeHttpFrom(healthModule);

interface TestServer {
  url: string;
  close(): Promise<void>;
}

/** Replies with headers, then streams chunks forever without ending. */
function startStreamingServer(intervalMs = 50): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      const timer = setInterval(() => {
        if (response.writableEnded || response.destroyed) return;
        response.write('chunk');
      }, intervalMs);
      timer.unref();
      response.on('close', () => clearInterval(timer));
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

describe('probeHttp', () => {
  it('returns the status code of a normal response', async () => {
    const server = await startHttpServer(200);
    try {
      expect(await probeHttp(server.url, 500)).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('gives up at the absolute deadline when a streamed response never ends', async () => {
    const server = await startStreamingServer();
    try {
      const started = Date.now();
      const code = await probeHttp(server.url, 300);
      const elapsed = Date.now() - started;

      expect(code).toBe(0);
      // The socket stays active (chunks every 50 ms), so only the absolute
      // deadline can end this probe; keep a wide margin over 300 ms.
      expect(elapsed).toBeLessThan(1500);
    } finally {
      await server.close();
    }
  });

  it('returns 0 for an unreachable port', async () => {
    const server = await startHttpServer(200);
    const url = server.url;
    await server.close();

    expect(await probeHttp(url, 300)).toBe(0);
  });
});
