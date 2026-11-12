import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';
import {
  createHarness,
  parseJsonObject,
  startGrafanaServer,
  type GrafanaFixture,
  type Harness,
} from '#test/unit/env/support';

interface GrafanaStatus {
  state: string;
  ok: boolean;
  minted: boolean;
  mintError: string | null;
  url: string;
  tokenFile: string;
  serviceAccount: string | null;
  role: string | null;
  tokenId: number | null;
  mintedAt: string | null;
  mcpBinary: boolean;
  detail: string | null;
}

interface GrafanaModule {
  inspectGrafana(options?: {
    healthTimeoutMs?: number;
    requestTimeoutMs?: number;
  }): Promise<GrafanaStatus>;
  ensureGrafanaToken(options?: {
    force?: boolean;
    healthTimeoutMs?: number;
    requestTimeoutMs?: number;
  }): Promise<GrafanaStatus>;
}

const grafana = await loadEnvModule<GrafanaModule>('lib/grafana.ts');

const baseline = { ...process.env };
const fixtures: GrafanaFixture[] = [];
const harnesses: Harness[] = [];
let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'studiq-grafana-'));
  process.env.HOME = home;
  delete process.env.GRAFANA_URL;
  process.env.GRAFANA_ADMIN_USER = 'admin';
  process.env.GRAFANA_ADMIN_PASSWORD = 'admin';
});

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
  for (const fixture of fixtures.splice(0)) await fixture.close();
  for (const key of Object.keys(process.env)) {
    if (!(key in baseline)) delete process.env[key];
  }
  Object.assign(process.env, baseline);
  rmSync(home, { recursive: true, force: true });
});

async function startFixture(options?: Parameters<typeof startGrafanaServer>[0]) {
  const fixture = await startGrafanaServer(options);
  fixtures.push(fixture);
  process.env.GRAFANA_URL = fixture.url;
  return fixture;
}

function tokenFile(): string {
  return join(home, '.config', 'studiq', 'observability', 'grafana-mcp-token');
}

function metaFile(): string {
  return join(home, '.config', 'studiq', 'observability', 'grafana-mcp.json');
}

function readToken(): string | null {
  return existsSync(tokenFile()) ? readFileSync(tokenFile(), 'utf8').trim() : null;
}

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

describe('Grafana MCP token', () => {
  it('reports no-token when the stack answers without a credential', async () => {
    const fixture = await startFixture();
    const status = await grafana.inspectGrafana();

    expect(status.state).toBe('no-token');
    expect(status.ok).toBe(false);
    expect(status.url).toBe(fixture.url);
    expect(status.tokenFile).toBe(
      join(home, '.config', 'studiq', 'observability', 'grafana-mcp-token'),
    );
  });

  it('mints a Viewer token once, writes it 0600, and is then a no-op', async () => {
    const fixture = await startFixture();

    const first = await grafana.ensureGrafanaToken();
    expect(first).toMatchObject({
      state: 'ok',
      ok: true,
      minted: true,
      serviceAccount: 'studiq-mcp',
      role: 'Viewer',
    });

    const file = tokenFile();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toBe('glsa_test_1');
    expect(readToken()).toBe('glsa_test_1');
    expect(JSON.parse(readFileSync(metaFile(), 'utf8'))).toMatchObject({
      serviceAccountName: 'studiq-mcp',
    });

    const second = await grafana.ensureGrafanaToken();
    expect(second.minted).toBe(false);
    expect(second.state).toBe('ok');
    expect(fixture.mintCount).toBe(1);
    expect(fixture.serviceAccounts).toHaveLength(1);
  });

  it('re-mints when the stored token no longer validates', async () => {
    const fixture = await startFixture();
    const file = tokenFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'glsa_stale\n', { mode: 0o600 });

    const status = await grafana.ensureGrafanaToken();

    expect(status.minted).toBe(true);
    expect(status.state).toBe('ok');
    expect(readFileSync(file, 'utf8')).toBe('glsa_test_1');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(fixture.mintCount).toBe(1);
  });

  it('re-mints on --force even when the current token validates', async () => {
    const fixture = await startFixture();
    await grafana.ensureGrafanaToken();
    const first = readFileSync(tokenFile(), 'utf8');

    const forced = await grafana.ensureGrafanaToken({ force: true });

    expect(forced.minted).toBe(true);
    expect(fixture.mintCount).toBe(2);
    expect(readFileSync(tokenFile(), 'utf8')).not.toBe(first);
  });

  it('does not write a token when the admin credential is rejected', async () => {
    const fixture = await startFixture({ adminPassword: 'not-admin' });
    process.env.GRAFANA_ADMIN_PASSWORD = 'admin';

    const status = await grafana.ensureGrafanaToken();

    expect(status.ok).toBe(false);
    expect(status.minted).toBe(false);
    expect(status.mintError).toMatch(/401/);
    expect(status.detail).toMatch(/401/);
    expect(fixture.mintCount).toBe(0);
    expect(existsSync(tokenFile())).toBe(false);
  });

  it('keeps the valid token when a forced re-mint is rejected', async () => {
    const fixture = await startFixture();
    await grafana.ensureGrafanaToken();
    const before = readFileSync(tokenFile(), 'utf8');
    process.env.GRAFANA_ADMIN_PASSWORD = 'wrong';

    const status = await grafana.ensureGrafanaToken({ force: true });

    expect(status.state).toBe('ok');
    expect(status.ok).toBe(true);
    expect(status.minted).toBe(false);
    expect(status.mintError).toMatch(/401/);
    expect(readFileSync(tokenFile(), 'utf8')).toBe(before);
    expect(fixture.mintCount).toBe(1);
  });

  it('reports unreachable instead of throwing when the stack is down', async () => {
    process.env.GRAFANA_URL = 'http://127.0.0.1:1';

    const status = await grafana.ensureGrafanaToken({ healthTimeoutMs: 200 });

    expect(status.state).toBe('unreachable');
    expect(status.minted).toBe(false);
    expect(existsSync(tokenFile())).toBe(false);
  });
});

describe('env:observability', () => {
  it('mints through the CLI and never prints the token', async () => {
    const harness = newHarness();
    const fixture = await startGrafanaServer();
    harness.track(() => fixture.close());

    const result = await harness.run(['observability', 'ensure', '--json'], {
      GRAFANA_URL: fixture.url,
    });

    expect(result.status).toBe(0);
    const payload = parseJsonObject(result.stdout);
    expect(payload).toMatchObject({ state: 'ok', ok: true, minted: true, role: 'Viewer' });
    expect(result.stdout).not.toContain('glsa_test_');

    const file = join(harness.dir, '.config', 'studiq', 'observability', 'grafana-mcp-token');
    expect(readFileSync(file, 'utf8')).toBe('glsa_test_1');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('reports no-token read-only and exits 0', async () => {
    const harness = newHarness();
    const fixture = await startGrafanaServer();
    harness.track(() => fixture.close());

    const result = await harness.run(['observability', 'status', '--json'], {
      GRAFANA_URL: fixture.url,
    });

    expect(result.status).toBe(0);
    expect(parseJsonObject(result.stdout)).toMatchObject({ state: 'no-token', minted: false });
    expect(fixture.mintCount).toBe(0);
  });

  it('reports unreachable read-only and exits 0', async () => {
    const harness = newHarness();

    const result = await harness.run(['observability', 'status', '--json'], {
      GRAFANA_URL: 'http://127.0.0.1:1',
    });

    expect(result.status).toBe(0);
    expect(parseJsonObject(result.stdout)).toMatchObject({ state: 'unreachable', ok: false });
  });

  it('exits 4 when ensure cannot reach the stack', async () => {
    const harness = newHarness();

    const result = await harness.run(['observability', 'ensure', '--json'], {
      GRAFANA_URL: 'http://127.0.0.1:1',
    });

    expect(result.status).toBe(4);
    expect(parseJsonObject(result.stdout)).toMatchObject({ state: 'unreachable', ok: false });
  });

  it('exits 4 and reports the mint error when a forced re-mint is rejected', async () => {
    const harness = newHarness();
    const fixture = await startGrafanaServer();
    harness.track(() => fixture.close());

    const minted = await harness.run(['observability', 'ensure', '--json'], {
      GRAFANA_URL: fixture.url,
    });
    expect(minted.status).toBe(0);

    const forced = await harness.run(['observability', 'ensure', '--force', '--json'], {
      GRAFANA_URL: fixture.url,
      GRAFANA_ADMIN_PASSWORD: 'wrong',
    });

    expect(forced.status).toBe(4);
    const payload = parseJsonObject(forced.stdout);
    expect(payload).toMatchObject({ state: 'ok', ok: true, minted: false });
    expect(payload.mintError).toMatch(/401/);
    expect(fixture.mintCount).toBe(1);
  });

  it('exits 2 when --force is used without ensure', async () => {
    const harness = newHarness();

    const result = await harness.run(['observability', '--force']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("'--force' requires 'ensure'");
  });
});
