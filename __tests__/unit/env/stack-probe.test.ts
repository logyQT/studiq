import { afterEach, describe, expect, it } from 'vitest';
import {
  BUN,
  createHarness,
  stackStatusFixture,
  stoppedStackFixture,
  type Harness,
} from '#test/unit/env/support';

/**
 * A `supabase stack status` probe that never answers is not an absent stack
 * (#1360): it is retried, and when it keeps failing `env:serve`, `env:build` and
 * `env:run` exit 8 with a message that does not say "no running Supabase stack".
 * Only a stack the CLI reports as stopped (exit 0, no API URL) is exit 4.
 */

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

function statusCalls(harness: Harness): number {
  return harness
    .bunxCalls()
    .split('\n')
    .filter((line) => line.startsWith('stack status')).length;
}

const PERSISTENT = 99;
const NO_RUNNING_STACK = /no running Supabase stack/;
const PROBE_FAILED = /could not read the Supabase stack status after 3 attempts/;

describe('stack status probe retry', () => {
  it('succeeds on the third attempt after two transient failures', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:31234', apiPort: 31_234 }),
    );
    harness.failStatusProbe(2);

    const result = await harness.run(['run', '--', BUN, '-e', 'process.exit(0)']);

    expect(result.status).toBe(0);
    expect(statusCalls(harness)).toBe(3);
  });

  it('does not retry a stopped stack (exit 0 without an API URL)', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());

    const result = await harness.run(['run', '--', BUN, '-e', 'process.exit(0)']);

    expect(result.status).toBe(4);
    expect(statusCalls(harness)).toBe(1);
  });
});

describe('a probe that never answers is not "no running stack"', () => {
  const commands: Array<[string, string[]]> = [
    ['env:serve', ['serve']],
    ['env:build', ['build']],
    ['env:run', ['run', '--', BUN, '-e', 'process.exit(0)']],
  ];

  it.each(commands)(
    '%s exits 8 after three attempts and does not claim the stack is gone',
    async (_name, args) => {
      const harness = newHarness();
      harness.setStatusFixture(
        stackStatusFixture({ apiUrl: 'http://127.0.0.1:31234', apiPort: 31_234 }),
      );
      harness.failStatusProbe(PERSISTENT);

      const result = await harness.run(args);

      expect(result.status).toBe(8);
      expect(result.stderr).toMatch(PROBE_FAILED);
      expect(result.stderr).not.toMatch(NO_RUNNING_STACK);
      expect(statusCalls(harness)).toBe(3);
    },
  );

  it.each(commands)(
    '%s still exits 4 "no running Supabase stack" for a stopped stack',
    async (_name, args) => {
      const harness = newHarness();
      harness.setStatusFixture(stoppedStackFixture());

      const result = await harness.run(args);

      expect(result.status).toBe(4);
      expect(result.stderr).toMatch(NO_RUNNING_STACK);
      expect(result.stderr).not.toMatch(PROBE_FAILED);
    },
  );

  it('env:run keeps the exported-contract fallback when the probe fails', async () => {
    const harness = newHarness();
    harness.failStatusProbe(PERSISTENT);

    const result = await harness.run(['run', '--', BUN, '-e', 'process.exit(0)'], {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'manual-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'manual-service-role-key',
    });

    expect(result.status).toBe(0);
  });
});
