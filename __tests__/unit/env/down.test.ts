import { afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  REPO_ROOT,
  stackStatusFixture,
  stoppedStackFixture,
  type Harness,
} from '#test/unit/env/support';

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

function listedStack(name: string, owner?: string): Record<string, unknown> {
  return {
    id: `fixture-${name}`,
    name,
    project_root: REPO_ROOT,
    branch_context: 'refs/heads/feat/env-fixture',
    runtime: 'native',
    ...(owner ? { owner } : {}),
  };
}

describe('env:down stack selection', () => {
  it('rejects an invalid SUPABASE_STACK for down --all instead of stopping the default', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    harness.setListFixture({ stacks: [listedStack('default')] });

    const result = await harness.run(['down', '--all', '--yes'], {
      SUPABASE_STACK: 'bad stack name',
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("SUPABASE_STACK='bad stack name' is not a valid stack name");
    expect(result.stderr).toContain("Refusing 'down --all' without an explicit --stack");
    // Nothing was probed or stopped: the default stack must stay untouched.
    expect(harness.bunxCalls()).toBe('');
  });

  it('keeps plain down working with an invalid SUPABASE_STACK', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());

    const result = await harness.run(['down'], { SUPABASE_STACK: 'bad stack name' });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Released the app-port lease (stack is stopped).');
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack status --output-format json');
    expect(calls).not.toContain('--stack');
    expect(calls).not.toContain('stack stop');
  });

  it('uses an explicit --stack even when SUPABASE_STACK is invalid', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    harness.setListFixture({ stacks: [listedStack('named')] });

    const result = await harness.run(['down', '--all', '--yes', '--stack', 'named'], {
      SUPABASE_STACK: 'bad stack name',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Stopped Supabase stack 'named' (data kept).");
    expect(harness.bunxCalls()).toContain('stack stop --output-format json --stack named');
  });

  it('stops the default stack for down --all when SUPABASE_STACK is unset', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    harness.setListFixture({ stacks: [listedStack('default')] });

    const result = await harness.run(['down', '--all', '--yes'], { SUPABASE_STACK: '' });

    expect(result.status).toBe(0);
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack stop --output-format json');
    expect(calls).not.toContain('--stack');
  });

  it('keeps the lease when a failed stop still lists the stack as running', async () => {
    const harness = newHarness();
    // No readable status (a null status is not proof of a stop), and the list
    // still shows this checkout's running stack.
    harness.setStatusFixture(stoppedStackFixture());
    harness.setListFixture({ stacks: [listedStack('default', 'reachable')] });

    const result = await harness.run(['down', '--all', '--yes'], {
      SUPABASE_STACK: '',
      FAKE_SUPA_EXIT: '1',
    });

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('stack stop failed');
    expect(result.stderr).toContain('keeping the lease');
    expect(result.stderr).not.toContain('Released the app-port lease.');
  });

  it('releases the lease when the list confirms a failed stop took effect', async () => {
    const harness = newHarness();
    // The stack was running when down started; after the failed stop the list
    // no longer shows this checkout's stack, so absence is confirmed.
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    harness.setListFixture({ stacks: [] });

    const result = await harness.run(['down', '--all', '--yes'], {
      SUPABASE_STACK: '',
      FAKE_SUPA_EXIT: '1',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Stopped Supabase stack 'default'");
    expect(result.stderr).toContain('Released the app-port lease.');
  });

  it('refuses to clean up when a failed stop leaves the stack unverifiable', async () => {
    const harness = newHarness();
    harness.setStatusFixture(
      stackStatusFixture({ apiUrl: 'http://127.0.0.1:20041', apiPort: 20041 }),
    );
    harness.setListFixture('not-json');

    const result = await harness.run(['down', '--all', '--yes'], {
      SUPABASE_STACK: '',
      FAKE_SUPA_EXIT: '1',
    });

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('stack stop failed');
    expect(result.stderr).not.toContain('Released the app-port lease.');
  });
});
