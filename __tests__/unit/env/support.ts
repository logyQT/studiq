import { spawn, type ChildProcess } from 'node:child_process';
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
import { tmpdir, networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../../../scripts/env/cli.ts', import.meta.url));
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

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

/** An absent log means "no calls"; any other read error must surface. */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function readLog(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return '';
    throw error;
  }
}

async function terminate(child: ChildProcess): Promise<void> {
  await new Promise<void>((done) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      done();
    };
    // Register before re-checking: a child can exit between the check and the
    // listener registration, and then `close` would never be observed.
    child.once('close', finish);
    child.once('error', finish);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
      return;
    }
    if (!child.kill('SIGKILL')) finish();
  });
}

export interface Harness {
  dir: string;
  registryDir: string;
  stateDir: string;
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
  const stateDir = join(dir, 'state');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
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
  const children = new Set<ChildProcess>();

  const env: NodeJS.ProcessEnv = {
    PATH: `${binDir}:${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
    HOME: dir,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    STUDIQ_DEV_REGISTRY: registryDir,
    STUDIQ_ENV_STATE_DIR: stateDir,
    // Isolate the per-stack `.dev` state: every harness gets its own identity.
    SUPABASE_STACK: `env-unit-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    FAKE_BUNX_LOG: bunxLog,
    FAKE_ENGINE_LOG: engineLog,
    FAKE_STACK_STATUS_FILE: statusFile,
    FAKE_STACK_LIST_FILE: listFile,
    FAKE_SUPA_APP_URL_FILE: appUrlFile,
  };

  return {
    dir,
    registryDir,
    stateDir,
    env,
    run(args, extraEnv = {}) {
      return new Promise<RunResult>((resolvePromise) => {
        const child = spawn(BUN, [CLI_PATH, ...args], {
          cwd: dir,
          env: { ...env, ...extraEnv },
          timeout: 20_000,
          killSignal: 'SIGKILL',
        });
        children.add(child);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer | string) => {
          stdout += String(chunk);
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
          stderr += String(chunk);
        });
        child.on('error', (error) => {
          children.delete(child);
          resolvePromise({
            status: null,
            stdout,
            stderr: `${stderr}spawn error: ${error.message}\n`,
          });
        });
        child.on('close', (code) => {
          children.delete(child);
          resolvePromise({ status: code, stdout, stderr });
        });
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
      return readLog(bunxLog);
    },
    engineCalls() {
      return readLog(engineLog);
    },
    track(closer) {
      closers.push(closer);
    },
    async cleanup() {
      // Every closer runs even if an earlier one throws, children are awaited
      // before their temp dir disappears, and the directory is removed last.
      let failure: Error | null = null;
      try {
        await Promise.all([...children].map((child) => terminate(child)));
        children.clear();
        for (const close of closers.toReversed()) {
          try {
            await close();
          } catch (error) {
            failure ??= error instanceof Error ? error : new Error(String(error));
          }
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      if (failure) throw failure;
    },
  };
}

export interface HttpServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

type Listenable = ReturnType<typeof createHttpServer> | ReturnType<typeof createTcpServer>;

/** Listen on all interfaces (or a specific host) so IPv4/IPv6 both work. */
function listen(server: Listenable, port: number, host?: string): Promise<number> {
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
    if (host) server.listen(port, host);
    else server.listen(port);
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
export async function startTcpListener(port = 0, host?: string): Promise<TcpListener> {
  const server = createTcpServer((socket) => socket.destroy());
  const bound = await listen(server, port, host);
  return {
    port: bound,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

/** First free port at or above `from`, skipping `skip`; defaults to the wildcard. */
export async function firstFreePort(
  from: number,
  skip: ReadonlySet<number> = new Set(),
  host = '0.0.0.0',
): Promise<number> {
  for (let port = from; port < from + 200; port += 1) {
    if (skip.has(port)) continue;
    const listener = await startTcpListener(port, host).catch(() => null);
    if (!listener) continue;
    await listener.close();
    return port;
  }
  throw new Error(`no free port found from ${from}`);
}

/** The first non-loopback IPv4 address, or null when the host has none. */
export function nonLoopbackIPv4(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

/** A port free both on `address` and on loopback (so the conflict is provable). */
export async function findConflictPort(address: string): Promise<number> {
  for (let port = 3000; port <= 3999; port += 1) {
    if (port === 3010) continue;
    const onAddress = await startTcpListener(port, address).catch(() => null);
    if (!onAddress) continue;
    await onAddress.close();
    const onLoopback = await startTcpListener(port, '127.0.0.1').catch(() => null);
    if (!onLoopback) continue;
    await onLoopback.close();
    return port;
  }
  throw new Error('no port free on both the non-loopback address and loopback');
}

/** A stopped stack: `stack status` exits 0 but carries no API URL/endpoints. */
export function stoppedStackFixture(): Record<string, unknown> {
  return {
    identity: {
      id: 'stopped-fixture-id',
      name: 'default',
      project_root: REPO_ROOT,
      branch_context: 'refs/heads/feat/env-fixture',
    },
    runtime: 'docker',
    lifecycle: null,
    config_drift: { status: 'unchanged' },
    env: {
      ANON_KEY: 'sentinel-stopped-anon',
      PUBLISHABLE_KEY: 'sentinel-stopped-publishable',
    },
    endpoints: {},
  };
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
