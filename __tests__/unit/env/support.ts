import { spawn } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../../../scripts/env/cli.ts', import.meta.url));
const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse one command's stdout; the payload stays `unknown` until narrowed. */
export function parseJsonObject(stdout: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed)) throw new Error('expected a JSON object on stdout');
  return parsed;
}

export function objectField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`expected '${key}' to be a JSON object`);
  return value;
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('expected a JSON array');
  return value.filter((item): item is string => typeof item === 'string');
}

export interface Harness {
  dir: string;
  registryDir: string;
  env: NodeJS.ProcessEnv;
  run(args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<RunResult>;
  setStatusFixture(value: unknown): void;
  setListFixture(value: unknown): void;
  writeRegistryEntry(entry: Record<string, unknown>): void;
  writeRawEntry(name: string, entry: unknown): void;
  bunxCalls(): string;
  engineCalls(): string;
  track(closer: () => Promise<void> | void): void;
  cleanup(): Promise<void>;
}

/** The Bun binary running this suite (absolute, so a child PATH cannot hide it). */
const BUN = (() => {
  if (process.versions.bun) return process.execPath;
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    try {
      accessSync(join(dir, 'bun'), constants.X_OK);
      return join(dir, 'bun');
    } catch {
      /* keep looking */
    }
  }
  return 'bun';
})();

/**
 * A fake `bunx` stands in for the Supabase CLI so every test is hermetic: it
 * records its arguments, serves the status/list fixtures and echoes the child
 * APP_URL, but it can never touch a real stack.
 */
const FAKE_BUNX = [
  '#!/usr/bin/env bash',
  'set -u',
  'if [ "${1:-}" = "supabase" ]; then shift; fi',
  'printf \'%s\\n\' "$*" >> "${FAKE_BUNX_LOG:?}"',
  'if [ "${1:-}" = "stack" ] && [ "${2:-}" = "status" ]; then',
  '  if [ -n "${FAKE_STACK_STATUS_FILE:-}" ] && [ -f "$FAKE_STACK_STATUS_FILE" ]; then',
  '    cat "$FAKE_STACK_STATUS_FILE"',
  '    exit "${FAKE_STACK_STATUS_EXIT:-0}"',
  '  fi',
  '  exit 1',
  'fi',
  'if [ "${1:-}" = "stack" ] && [ "${2:-}" = "list" ]; then',
  '  if [ -n "${FAKE_STACK_LIST_FILE:-}" ] && [ -f "$FAKE_STACK_LIST_FILE" ]; then',
  '    cat "$FAKE_STACK_LIST_FILE"',
  '  else',
  '    printf \'{"stacks":[]}\'',
  '  fi',
  '  exit 0',
  'fi',
  'if [ -n "${FAKE_SUPA_STDOUT:-}" ]; then printf \'%s\' "$FAKE_SUPA_STDOUT"; fi',
  'if [ -n "${FAKE_SUPA_APP_URL_FILE:-}" ]; then printf \'%s\\n\' "${APP_URL:-<unset>}" >> "$FAKE_SUPA_APP_URL_FILE"; fi',
  'exit "${FAKE_SUPA_EXIT:-0}"',
  '',
].join('\n');

export function createHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-env-test-'));
  const binDir = join(dir, 'bin');
  const registryDir = join(dir, 'registry');
  mkdirSync(binDir, { recursive: true });
  const bunxPath = join(binDir, 'bunx');
  writeFileSync(bunxPath, FAKE_BUNX, { mode: 0o755 });
  chmodSync(bunxPath, 0o755);

  // Container-engine stubs: read-only commands must never probe these.
  for (const engine of ['docker', 'podman']) {
    const enginePath = join(binDir, engine);
    writeFileSync(
      enginePath,
      [
        '#!/usr/bin/env bash',
        `printf '%s\\n' "${engine} $*" >> "$FAKE_ENGINE_LOG"`,
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    chmodSync(enginePath, 0o755);
  }

  const bunxLog = join(dir, 'bunx.log');
  const engineLog = join(dir, 'engine.log');
  const statusFile = join(dir, 'stack-status.json');
  const listFile = join(dir, 'stack-list.json');
  const appUrlFile = join(dir, 'supa-app-url.txt');
  const closers: Array<() => Promise<void> | void> = [];

  const env: NodeJS.ProcessEnv = {
    PATH: `${binDir}:${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
    HOME: dir,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    STUDIQ_DEV_REGISTRY: registryDir,
    FAKE_BUNX_LOG: bunxLog,
    FAKE_ENGINE_LOG: engineLog,
    FAKE_STACK_STATUS_FILE: statusFile,
    FAKE_STACK_LIST_FILE: listFile,
    FAKE_SUPA_APP_URL_FILE: appUrlFile,
  };

  return {
    dir,
    registryDir,
    env,
    run(args, extraEnv = {}) {
      return new Promise<RunResult>((resolvePromise) => {
        const child = spawn(BUN, [CLI_PATH, ...args], {
          cwd: dir,
          env: { ...env, ...extraEnv },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer | string) => {
          stdout += String(chunk);
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
          stderr += String(chunk);
        });
        child.on('error', () => resolvePromise({ status: 1, stdout, stderr }));
        child.on('close', (code) => resolvePromise({ status: code, stdout, stderr }));
      });
    },
    setStatusFixture(value) {
      writeFileSync(statusFile, JSON.stringify(value));
    },
    setListFixture(value) {
      writeFileSync(listFile, JSON.stringify(value));
    },
    writeRegistryEntry(entry) {
      mkdirSync(registryDir, { recursive: true });
      writeFileSync(join(registryDir, `${String(entry.projectId)}.json`), JSON.stringify(entry));
    },
    writeRawEntry(name, entry) {
      mkdirSync(registryDir, { recursive: true });
      writeFileSync(join(registryDir, name), JSON.stringify(entry));
    },
    bunxCalls() {
      try {
        return readFileSync(bunxLog, 'utf8');
      } catch {
        return '';
      }
    },
    engineCalls() {
      try {
        return readFileSync(engineLog, 'utf8');
      } catch {
        return '';
      }
    },
    track(closer) {
      closers.push(closer);
    },
    async cleanup() {
      for (const close of closers.toReversed()) await close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface HttpServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

type Listenable = ReturnType<typeof createHttpServer> | ReturnType<typeof createTcpServer>;

/** Listen on all interfaces (so `localhost` works over IPv4 and IPv6). */
function listen(server: Listenable, port: number): Promise<number> {
  return new Promise((done, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      done(typeof address === 'object' && address ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

/** A real HTTP server (for the health probes); every request answers `status`. */
export async function startHttpServer(status = 200): Promise<HttpServer> {
  const server = createHttpServer((_request, response) => {
    response.statusCode = status;
    response.end('ok');
  });
  const port = await listen(server, 0);
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

export interface TcpListener {
  port: number;
  close(): Promise<void>;
}

/** A TCP listener that accepts and closes, to occupy an app port. */
export async function startTcpListener(port = 0): Promise<TcpListener> {
  const server = createTcpServer((socket) => socket.destroy());
  const bound = await listen(server, port);
  return {
    port: bound,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

/** First free loopback port at or above `from`, skipping `skip`. */
export async function firstFreePort(
  from: number,
  skip: ReadonlySet<number> = new Set(),
): Promise<number> {
  for (let port = from; port < from + 200; port += 1) {
    if (skip.has(port)) continue;
    const listener = await startTcpListener(port).catch(() => null);
    if (!listener) continue;
    await listener.close();
    return port;
  }
  throw new Error(`no free port found from ${from}`);
}

export interface StackFixtureOptions {
  apiUrl: string;
  apiPort: number;
  dbUrl?: string;
  studioUrl?: string;
  mailUrl?: string;
  runtime?: string;
}

/** A realistic `supabase stack status --output-format json` payload, with key facts. */
export function stackStatusFixture(options: StackFixtureOptions): Record<string, unknown> {
  return {
    identity: {
      id: 'fixture-stack-id-000000000000000000000000000000000000000000000000000000',
      name: 'default',
      project_root: REPO_ROOT,
      branch_context: 'refs/heads/feat/env-fixture',
    },
    runtime: options.runtime ?? 'native',
    lifecycle: 'running',
    config_drift: { status: 'unchanged' },
    env: {
      API_URL: options.apiUrl,
      DB_URL: options.dbUrl ?? 'postgresql://postgres:fixture-db-password@127.0.0.1:30040/postgres',
      STUDIO_URL: options.studioUrl ?? 'http://127.0.0.1:31136',
      MAILPIT_URL: options.mailUrl ?? 'http://127.0.0.1:20503',
      // Sentinels: none of these may ever reach the JSON contract.
      ANON_KEY: 'sentinel-anon-key-value',
      SERVICE_ROLE_KEY: 'sentinel-service-role-value',
      PUBLISHABLE_KEY: 'sentinel-publishable-value',
      SECRET_KEY: 'sentinel-secret-key-value',
      S3_PROTOCOL_ACCESS_KEY_ID: 'sentinel-s3-access-id',
      S3_PROTOCOL_ACCESS_KEY_SECRET: 'sentinel-s3-access-secret',
    },
    endpoints: {
      'rest.http': { port: options.apiPort },
      'auth.http': { port: options.apiPort },
      'database.sql': { port: 30040 },
      'studio.http': { port: 31136 },
      'mail.http': { port: 20503 },
      'mail.smtp': { port: 20395 },
      'mail.pop3': { port: 29709 },
      'pgmeta.http': { port: 29285 },
    },
  };
}
