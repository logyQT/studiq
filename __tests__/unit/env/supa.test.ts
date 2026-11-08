import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, REPO_ROOT, type Harness } from '#test/unit/env/support';

const harnesses: Harness[] = [];

const OWN_ID = 'a'.repeat(64);
const FOREIGN_ID = 'b'.repeat(64);

/** Two stacks, one this checkout owns and one it does not. */
function listFixture(): unknown {
  return {
    stacks: [
      {
        id: OWN_ID,
        name: 'default',
        project_root: REPO_ROOT,
        branch_context: 'refs/heads/feat/env',
        runtime: 'native',
      },
      {
        id: FOREIGN_ID,
        name: 'foreign',
        project_root: '/tmp/foreign-checkout',
        branch_context: 'refs/heads/other',
        runtime: 'docker',
      },
    ],
  };
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

function newHarness(): Harness {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
}

function readAppUrl(harness: Harness): string {
  return readFileSync(join(harness.dir, 'supa-app-url.txt'), 'utf8').trim();
}

describe('env:supa', () => {
  it('forwards every argument verbatim, including the -- separator', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', '--', '--version'], {
      FAKE_SUPA_STDOUT: 'fake-supa 9.9.9',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('fake-supa 9.9.9');
    expect(harness.bunxCalls().trim()).toBe('--version');
  });

  it('passes --json to the Supabase CLI instead of interpreting it', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', '--json'], {});

    expect(result.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('--json');
  });

  it('exports APP_URL from APP_PORT for config.toml env()', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'status'], { APP_PORT: '3210' });

    expect(result.status).toBe(0);
    expect(readAppUrl(harness)).toBe('http://localhost:3210');
  });

  it('lets an explicit APP_URL win', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'status'], {
      APP_PORT: '3210',
      APP_URL: 'https://staging.example.test',
    });

    expect(result.status).toBe(0);
    expect(readAppUrl(harness)).toBe('https://staging.example.test');
  });

  it('propagates the child exit code', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'bogus'], { FAKE_SUPA_EXIT: '7' });
    expect(result.status).toBe(7);
  });

  it('rejects stop --all with exit 2 and never spawns the CLI', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'stop', '--all']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('stop --all');
    expect(result.stderr).toContain('stack stop --stack');
    expect(harness.bunxCalls()).toBe('');
  });

  it('rejects stop --all in any argument order', async () => {
    const variants = [
      ['stop', '--all'],
      ['--all', 'stop'],
      ['stop', '--project-id', 'abc', '--all'],
      ['stop', '--', '--all'],
    ];
    for (const args of variants) {
      const harness = newHarness();
      const result = await harness.run(['supa', ...args]);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stdout, args.join(' ')).toBe('');
      expect(harness.bunxCalls(), args.join(' ')).toBe('');
    }
  });

  it('forwards a scoped stack stop for a stack this checkout owns', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run(['supa', 'stop', '--stack', 'default']);

    expect(result.status).toBe(0);
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack list --output-format json');
    expect(calls).toContain('stop --stack default');
  });

  it('forwards a stop scoped by unique id prefix', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run(['supa', 'stop', '--stack-id', 'aaaa']);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls()).toContain('stop --stack-id aaaa');
  });

  it('forwards a scoped stack restart for a stack this checkout owns', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run(['supa', 'stack', 'restart', '--stack', 'default']);

    expect(result.status).toBe(0);
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack list --output-format json');
    expect(calls).toContain('stack restart --stack default');
  });

  it('refuses restart without a stack scope (exit 2, no spawn)', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'restart']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--stack <name>');
    expect(harness.bunxCalls()).toBe('');
  });

  it('rejects restart --all (exit 2, no spawn)', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'stack', 'restart', '--all']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('restart --all');
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses to restart a stack owned by another checkout (exit 6)', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run(['supa', 'restart', '--stack', 'foreign']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('owned by /tmp/foreign-checkout');
    expect(harness.bunxCalls()).not.toContain('restart');
  });

  it('rejects db reset outright (exit 2, no spawn)', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'db', 'reset']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('env:reset-db --yes');
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses to stop a stack owned by another checkout (exit 6)', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run(['supa', 'stop', '--stack', 'foreign']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('owned by /tmp/foreign-checkout');
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack list --output-format json');
    expect(calls).not.toContain('stop');
  });

  it('refuses to stop a stack it cannot find (exit 6)', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run(['supa', 'stop', '--stack', 'missing']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("not found in 'supabase stack list'");
    expect(harness.bunxCalls()).not.toContain('stop');
  });

  it('refuses stop without a stack scope (exit 2, no spawn)', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'stop']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--stack <name>');
    expect(harness.bunxCalls()).toBe('');
  });

  it('rejects stack destroy outright (exit 2, no spawn)', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'stack', 'destroy', '--stack', 'default']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('destroy');
    expect(result.stderr).toContain('env:recreate --yes');
    expect(harness.bunxCalls()).toBe('');
  });

  it('rejects a bare destroy outright (exit 2, no spawn)', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'destroy', '--yes']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(harness.bunxCalls()).toBe('');
  });

  it('forwards a stack list unchanged', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'stack', 'list']);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('stack list');
  });
});
