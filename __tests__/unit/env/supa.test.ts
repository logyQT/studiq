import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '#test/unit/env/support';

const harnesses: Harness[] = [];

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

  it('forwards a scoped stack stop unchanged', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'stop', '--stack', 'default']);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('stop --stack default');
  });

  it('forwards a stack list unchanged', async () => {
    const harness = newHarness();
    const result = await harness.run(['supa', 'stack', 'list']);

    expect(result.status).toBe(0);
    expect(harness.bunxCalls().trim()).toBe('stack list');
  });
});
