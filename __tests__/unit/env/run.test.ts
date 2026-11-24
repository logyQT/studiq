import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUN,
  createHarness,
  parseJsonObject,
  stackStatusFixture,
  stoppedStackFixture,
  type Harness,
} from '#test/unit/env/support';

const harnesses: Harness[] = [];

// The tool normalizes a loopback URL to `localhost` (see `normalizeLocalhost`),
// so the fixture reports 127.0.0.1 and the child must see the localhost form.
const STACK_URL = 'http://127.0.0.1:31234';
const API_URL = 'http://localhost:31234';
const API_PORT = 31_234;

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

/** A running stack for this checkout, as `stack status --output-format json` reports it. */
function runningStack(harness: Harness): void {
  harness.setStatusFixture(stackStatusFixture({ apiUrl: STACK_URL, apiPort: API_PORT }));
}

/**
 * The child prints only what it can see in its own environment, so the
 * assertions read the same contract a QA spec or the seeder would.
 */
const PRINT_CONTRACT = [
  'console.log(JSON.stringify({',
  '  url: process.env.NEXT_PUBLIC_SUPABASE_URL,',
  '  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,',
  '  serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,',
  '  db: process.env.SUPABASE_DB_URL,',
  '  app: process.env.APP_URL,',
  '  qa: process.env.QA_APP_URL,',
  '  appEnv: process.env.APP_ENV,',
  '  appPort: process.env.APP_PORT,',
  '}))',
].join('\n');

describe('env:run', () => {
  it('requires a command (exit 2) and prints the usage line', async () => {
    const harness = newHarness();
    const result = await harness.run(['run']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('bun run env:run -- <command> [args…]');
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses the Supabase CLI (exit 2) and spawns nothing', async () => {
    const variants = [
      ['supabase', 'status'],
      ['bunx', 'supabase', 'status'],
      ['npx', 'supabase', 'status'],
      ['/usr/local/bin/supabase', 'status'],
    ];
    for (const args of variants) {
      const harness = newHarness();
      runningStack(harness);
      const result = await harness.run(['run', '--', ...args]);

      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stdout, args.join(' ')).toBe('');
      expect(result.stderr, args.join(' ')).toContain('bun run env:supa');
      expect(harness.bunxCalls(), args.join(' ')).not.toContain('status');
    }
  });

  it('exports the running stack contract plus QA_APP_URL to the child', async () => {
    const harness = newHarness();
    runningStack(harness);

    const result = await harness.run(['run', '--', BUN, '-e', PRINT_CONTRACT], {
      APP_PORT: '3456',
    });

    expect(result.status).toBe(0);
    const printed = parseJsonObject(result.stdout);
    expect(printed).toEqual({
      url: API_URL,
      anon: 'sentinel-anon-key-value',
      serviceRole: 'sentinel-service-role-value',
      db: 'postgresql://postgres:fixture-db-password@127.0.0.1:30040/postgres',
      app: 'http://localhost:3456',
      qa: 'http://localhost:3456',
      appEnv: 'development',
      appPort: '3456',
    });
  });

  it('overrides a QA_APP_URL already pointing at the shared app', async () => {
    const harness = newHarness();
    runningStack(harness);

    const result = await harness.run(
      ['run', '--', BUN, '-e', 'console.log(process.env.QA_APP_URL)'],
      {
        APP_PORT: '3456',
        QA_APP_URL: 'http://localhost:3010',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('http://localhost:3456');
  });

  it('propagates the child exit code', async () => {
    const harness = newHarness();
    runningStack(harness);

    const result = await harness.run(['run', '--', BUN, '-e', 'process.exit(7)']);

    expect(result.status).toBe(7);
  });

  it('fails with exit 4 and the env:ensure hint when no contract is available', async () => {
    const harness = newHarness();
    // A stopped stack is an answer; a status call that fails is exit 8 (#1360).
    harness.setStatusFixture(stoppedStackFixture());
    const marker = join(harness.dir, 'spawned.txt');

    const result = await harness.run([
      'run',
      '--',
      BUN,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`,
    ]);

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('bun run env:ensure --profile web');
    expect(existsSync(marker)).toBe(false);
  });

  it('runs a stopped stack’s contract from the environment and sets QA_APP_URL', async () => {
    const harness = newHarness();

    const result = await harness.run(['run', '--', BUN, '-e', PRINT_CONTRACT], {
      APP_PORT: '3456',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'manual-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'manual-service-role-key',
    });

    expect(result.status).toBe(0);
    const printed = parseJsonObject(result.stdout);
    expect(printed).toMatchObject({
      url: 'http://localhost:54321',
      anon: 'manual-anon-key',
      serviceRole: 'manual-service-role-key',
      app: 'http://localhost:3456',
      qa: 'http://localhost:3456',
    });
  });
});
