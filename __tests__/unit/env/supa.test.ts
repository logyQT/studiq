import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  REPO_ROOT,
  stoppedStackFixture,
  type Harness,
} from '#test/unit/env/support';

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
  it('strips the -- separator and forwards every argument', async () => {
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

  it('rejects --all=true for stop/restart (exit 2, no spawn)', async () => {
    const harness = newHarness();

    const stop = await harness.run(['supa', 'stop', '--stack', 'default', '--all=true']);
    expect(stop.status).toBe(2);
    expect(stop.stdout).toBe('');
    expect(harness.bunxCalls()).toBe('');

    const restart = await harness.run(['supa', 'restart', '--stack', 'default', '--all=false']);
    expect(restart.status).toBe(2);
    expect(restart.stdout).toBe('');
    expect(harness.bunxCalls()).toBe('');
  });

  it('parses the command after global flags with values', async () => {
    const harness = newHarness();

    const stop = await harness.run(['supa', '--output-format', 'json', 'stop', '--all']);
    expect(stop.status).toBe(2);
    expect(stop.stdout).toBe('');
    expect(harness.bunxCalls()).toBe('');

    const start = await harness.run([
      'supa',
      '--output-format',
      'json',
      'stack',
      'start',
      '--stack',
      'x',
    ]);
    expect(start.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('--output-format json stack start --stack x');
  });

  it('skips separated boolean global values before the command', async () => {
    const harness = newHarness();

    const stop = await harness.run(['supa', '--debug', 'false', 'stop', '--all']);
    expect(stop.status).toBe(2);
    expect(stop.stdout).toBe('');
    expect(harness.bunxCalls()).toBe('');

    const list = await harness.run(['supa', '--debug', 'false', 'stack', 'list']);
    expect(list.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('--debug false stack list');
  });

  it('skips every separated boolean value before the command', async () => {
    const harness = newHarness();

    for (const value of ['no', 'yes', 'on', 'off', '0', '1']) {
      const result = await harness.run(['supa', '--debug', value, 'stop', '--all']);
      expect(result.status, value).toBe(2);
      expect(result.stdout, value).toBe('');
      expect(harness.bunxCalls(), value).toBe('');
    }

    const list = await harness.run(['supa', '--debug', 'no', 'stack', 'list']);
    expect(list.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('--debug no stack list');
  });

  it('forwards start --stack stop (the stack name is a value, not a command)', async () => {
    const harness = newHarness();

    const result = await harness.run(['supa', 'start', '--stack', 'stop']);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('start --stack stop');
  });

  it('forwards a db start outside shared mode', async () => {
    const harness = newHarness();

    const result = await harness.run(['supa', 'db', 'start']);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('db start');
  });

  it('forwards a start without --stack-id without reading the stack list', async () => {
    const harness = newHarness();

    const result = await harness.run(['supa', 'start', '--stack', 'test']);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('start --stack test');
  });

  it('forwards a start for a --stack-id this checkout owns', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run(['supa', 'start', '--stack-id', 'aaaa']);

    expect(result.status).toBe(0);
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack list --output-format json');
    expect(calls).toContain('start --stack-id aaaa');
  });

  it('refuses to start a --stack-id owned by another checkout (exit 6, no spawn)', async () => {
    const variants = [
      ['start', '--stack-id', 'bbbb'],
      ['stack', 'start', '--stack-id=bbbb'],
    ];
    for (const args of variants) {
      const harness = newHarness();
      harness.setListFixture(listFixture());

      const result = await harness.run(['supa', ...args]);

      expect(result.status, args.join(' ')).toBe(6);
      expect(result.stdout, args.join(' ')).toBe('');
      expect(result.stderr, args.join(' ')).toContain('owned by /tmp/foreign-checkout');
      const calls = harness.bunxCalls();
      expect(calls, args.join(' ')).toContain('stack list --output-format json');
      expect(calls, args.join(' ')).not.toContain('start --stack-id');
    }
  });

  it('refuses to start a --stack-id it cannot resolve (exit 6, no spawn)', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run(['supa', 'start', '--stack-id', 'ffff']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("not found in 'supabase stack list'");
    expect(harness.bunxCalls()).not.toContain('start --stack-id');
  });

  it('refuses a start --stack-id without a usable value (exit 6, no spawn)', async () => {
    const variants = [
      ['start', '--stack-id'],
      ['start', '--stack-id='],
      ['start', '--stack-id', '--stack', 'default'],
      ['stack', 'start', '--stack-id='],
    ];
    for (const args of variants) {
      const harness = newHarness();
      const result = await harness.run(['supa', ...args]);
      const label = args.join(' ');

      expect(result.status, label).toBe(6);
      expect(result.stdout, label).toBe('');
      expect(result.stderr, label).toContain(
        "'--stack-id' requires a stack id owned by this checkout",
      );
      // The refusal happens before the stack list is read, so nothing spawns.
      expect(harness.bunxCalls(), label).toBe('');
    }
  });

  it('refuses a start --stack-id when stack list cannot be read (exit 6, no spawn)', async () => {
    const variants = [
      ['start', '--stack-id', 'aaaa'],
      ['stack', 'start', '--stack-id=aaaa'],
    ];
    for (const args of variants) {
      const harness = newHarness();
      harness.setListFixture('not-json');
      const result = await harness.run(['supa', ...args]);
      const label = args.join(' ');

      expect(result.status, label).toBe(6);
      expect(result.stdout, label).toBe('');
      expect(result.stderr, label).toContain(
        "cannot read 'supabase stack list' to verify ownership",
      );
      expect(result.stderr, label).toContain('aaaa');
      const calls = harness.bunxCalls();
      expect(calls, label).toContain('stack list --output-format json');
      expect(calls, label).not.toContain('start --stack-id');
    }
  });

  it('refuses an ambiguous start --stack-id prefix (exit 6, no spawn)', async () => {
    const harness = newHarness();
    harness.setListFixture({
      stacks: [
        {
          id: `${'a'.repeat(63)}1`,
          name: 'one',
          project_root: REPO_ROOT,
          branch_context: 'refs/heads/feat/env',
          runtime: 'native',
        },
        {
          id: `${'a'.repeat(63)}2`,
          name: 'two',
          project_root: REPO_ROOT,
          branch_context: 'refs/heads/feat/env',
          runtime: 'native',
        },
      ],
    });

    const result = await harness.run(['supa', 'start', '--stack-id', 'a']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('prefix matches more than one stack');
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack list --output-format json');
    expect(calls).not.toContain('start --stack-id');
  });

  it('refuses a start whose --stack-id flags name different stacks (exit 6, no spawn)', async () => {
    const harness = newHarness();
    harness.setListFixture({
      stacks: [
        {
          id: 'c'.repeat(64),
          name: 'one',
          project_root: REPO_ROOT,
          branch_context: 'refs/heads/feat/env',
          runtime: 'native',
        },
        {
          id: 'd'.repeat(64),
          name: 'two',
          project_root: REPO_ROOT,
          branch_context: 'refs/heads/feat/env',
          runtime: 'native',
        },
      ],
    });

    const result = await harness.run(['supa', 'start', '--stack-id', 'cccc', '--stack-id', 'dddd']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("'--stack-id' names different stacks");
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack list --output-format json');
    expect(calls).not.toContain('start --stack-id');
  });

  it('refuses an empty start --workdir (exit 6, no spawn)', async () => {
    const variants = [
      ['start', '--workdir', ''],
      ['start', '--workdir='],
      ['stack', 'start', '--workdir='],
      ['db', 'start', '--workdir', ''],
    ];
    for (const args of variants) {
      const harness = newHarness();
      const result = await harness.run(['supa', ...args]);
      const label = args.join(' ');

      expect(result.status, label).toBe(6);
      expect(result.stdout, label).toBe('');
      expect(result.stderr, label).toContain("--workdir '(empty)'");
      expect(harness.bunxCalls(), label).toBe('');
    }
  });

  it('refuses a start whose --workdir is another checkout (exit 6, no spawn)', async () => {
    const harness = newHarness();

    const result = await harness.run(['supa', 'start', '--workdir', '/tmp/foreign-checkout']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--workdir');
    expect(result.stderr).toContain(REPO_ROOT);
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses a start when SUPABASE_WORKDIR is another checkout (exit 6)', async () => {
    const harness = newHarness();

    const result = await harness.run(['supa', 'db', 'start'], {
      SUPABASE_WORKDIR: '/tmp/foreign-checkout',
    });

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--workdir');
    expect(harness.bunxCalls()).toBe('');
  });

  it('allows a start workdir that resolves to this checkout', async () => {
    const harness = newHarness();

    const result = await harness.run(['supa', 'start', '--workdir', REPO_ROOT]);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls()).toContain(`start --workdir ${REPO_ROOT}`);
  });

  it('still guards stop --stack stop', async () => {
    const harness = newHarness();
    harness.setListFixture({
      stacks: [
        {
          id: 'c'.repeat(64),
          name: 'stop',
          project_root: REPO_ROOT,
          branch_context: 'refs/heads/feat/env',
          runtime: 'native',
        },
      ],
    });

    const result = await harness.run(['supa', 'stop', '--stack', 'stop']);

    expect(result.status).toBe(0);
    const calls = harness.bunxCalls();
    expect(calls).toContain('stack list --output-format json');
    expect(calls).toContain('stop --stack stop');
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
    expect(result.stderr).toContain('env:down --all');
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses a stop whose --workdir is another checkout (exit 6, no spawn)', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run([
      'supa',
      'stop',
      '--stack',
      'default',
      '--workdir',
      '/tmp/foreign-checkout',
    ]);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--workdir');
    expect(result.stderr).toContain(REPO_ROOT);
    expect(harness.bunxCalls()).toBe('');
  });

  it('refuses a restart when SUPABASE_WORKDIR is another checkout (exit 6)', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run(['supa', 'restart', '--stack', 'default'], {
      SUPABASE_WORKDIR: '/tmp/foreign-checkout',
    });

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--workdir');
    expect(harness.bunxCalls()).toBe('');
  });

  it('allows a workdir that resolves to this checkout', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const result = await harness.run([
      'supa',
      'stop',
      '--stack',
      'default',
      '--workdir',
      REPO_ROOT,
    ]);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls()).toContain(`stop --stack default --workdir ${REPO_ROOT}`);
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

  it('refuses to stop when stack list cannot be read (exit 6)', async () => {
    const harness = newHarness();
    harness.setListFixture('not-json');

    const result = await harness.run(['supa', 'stop', '--stack', 'default']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(harness.bunxCalls()).not.toContain('stop');
  });

  it('refuses an ambiguous --stack-id prefix (exit 6)', async () => {
    const harness = newHarness();
    harness.setListFixture({
      stacks: [
        {
          id: `${'a'.repeat(63)}1`,
          name: 'one',
          project_root: REPO_ROOT,
          branch_context: 'refs/heads/feat/env',
          runtime: 'native',
        },
        {
          id: `${'a'.repeat(63)}2`,
          name: 'two',
          project_root: REPO_ROOT,
          branch_context: 'refs/heads/feat/env',
          runtime: 'native',
        },
      ],
    });

    const result = await harness.run(['supa', 'stop', '--stack-id', 'a']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(harness.bunxCalls()).not.toContain('stop');
  });

  it('refuses a --stack and --stack-id that name different stacks (exit 6)', async () => {
    const harness = newHarness();
    harness.setListFixture({
      stacks: [
        {
          id: 'b'.repeat(64),
          name: 'default',
          project_root: REPO_ROOT,
          branch_context: 'refs/heads/feat/env',
          runtime: 'native',
        },
        {
          id: 'c'.repeat(64),
          name: 'other',
          project_root: REPO_ROOT,
          branch_context: 'refs/heads/feat/env',
          runtime: 'native',
        },
      ],
    });

    const result = await harness.run(['supa', 'stop', '--stack', 'default', '--stack-id', 'cccc']);

    expect(result.status).toBe(6);
    expect(result.stdout).toBe('');
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(harness.bunxCalls()).not.toContain('stop');
  });

  it('refuses an empty --workdir (exit 6)', async () => {
    const harness = newHarness();
    harness.setListFixture(listFixture());

    const variants = [
      ['stop', '--stack', 'default', '--workdir', ''],
      ['stop', '--stack', 'default', '--workdir='],
    ];
    for (const args of variants) {
      const result = await harness.run(['supa', ...args]);
      expect(result.status, args.join(' ')).toBe(6);
      expect(result.stdout, args.join(' ')).toBe('');
      expect(harness.bunxCalls(), args.join(' ')).not.toContain('stop');
    }
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
    expect(result.stderr).toContain('env:down --all --yes');
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

describe('env:supa under SUPABASE_SHARED=1', () => {
  const sharedEnv = { SUPABASE_SHARED: '1', SUPABASE_SHARED_OWNER: 'qa-crew' };

  const rejected = [
    ['start'],
    ['stack', 'start'],
    ['stop'],
    ['stack', 'stop'],
    ['restart'],
    ['stack', 'restart'],
    ['destroy'],
    ['stack', 'destroy'],
    ['db', 'reset'],
    ['db', 'start'],
    ['migration', 'down'],
    ['storage', 'rm'],
  ];

  it('refuses every stop-capable or destructive form (exit 6, no spawn)', async () => {
    for (const args of rejected) {
      const harness = newHarness();
      const result = await harness.run(['supa', ...args], sharedEnv);
      const label = args.join(' ');

      expect(result.status, label).toBe(6);
      expect(result.stdout, label).toBe('');
      expect(result.stderr, label).toContain('SUPABASE_SHARED');
      expect(result.stderr, label).toContain('qa-crew');
      expect(harness.bunxCalls(), label).toBe('');
    }
  });

  it('refuses stack start (exit 6, no spawn) even behind global flags', async () => {
    const variants = [
      ['stack', 'start', '--stack', 'test'],
      ['stack', 'start'],
      ['start'],
      ['--output-format', 'json', 'stack', 'start', '--stack', 'test'],
    ];
    for (const args of variants) {
      const harness = newHarness();
      const result = await harness.run(['supa', ...args], sharedEnv);
      const label = args.join(' ');

      expect(result.status, label).toBe(6);
      expect(result.stdout, label).toBe('');
      expect(result.stderr, label).toContain('SUPABASE_SHARED');
      expect(result.stderr, label).toContain('qa-crew');
      expect(harness.bunxCalls(), label).toBe('');
    }
  });

  it('forwards stack start outside shared mode', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'stack', 'start', '--stack', 'test']);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('stack start --stack test');
  });

  it('still forwards read-only forms', async () => {
    const list = newHarness();
    const listResult = await list.run(['supa', 'stack', 'list'], sharedEnv);
    expect(listResult.status).toBe(0);
    expect(list.bunxCalls().trim()).toBe('stack list');

    const status = newHarness();
    status.setStatusFixture(stoppedStackFixture());
    const statusResult = await status.run(['supa', 'stack', 'status'], sharedEnv);
    expect(statusResult.status).toBe(0);
    expect(status.bunxCalls().trim()).toBe('stack status');

    const version = newHarness();
    const versionResult = await version.run(['supa', '--version'], sharedEnv);
    expect(versionResult.status).toBe(0);
    expect(version.bunxCalls().trim()).toBe('--version');
  });

  it('rejects a non-boolean SUPABASE_SHARED before forwarding a mutation', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'migration', 'down'], {
      SUPABASE_SHARED: 'true',
      SUPABASE_SHARED_OWNER: 'qa-crew',
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('SUPABASE_SHARED must be 0 or 1');
    expect(harness.bunxCalls()).toBe('');
  });
});
