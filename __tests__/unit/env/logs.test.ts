import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  parseJsonObject,
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

describe('env:logs', () => {
  it('keeps --json stdout to one object and sends the web log lines to stderr', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const log = join(harness.stateDir, 'web.log');
    const lines = Array.from({ length: 120 }, (_, index) => `web log line ${index + 1}`);
    writeFileSync(log, `${lines.join('\n')}\n`);

    const result = await harness.run(['logs', '--json', '--no-follow']);

    expect(result.status).toBe(0);
    // `JSON.parse` fails on the second line, so this is the whole stdout contract.
    const header = parseJsonObject(result.stdout);
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(header.log).toBe('.dev/web.log');
    expect(result.stderr).toContain(`──── ${log} ────`);
    expect(result.stderr).toContain(`web log line ${lines.length}`);
    expect(result.stderr).toContain('web log line 21');
  });

  it('follows appended lines and restarts on a rewritten log, keeping --json stdout to one object', async () => {
    const harness = newHarness();
    harness.setStatusFixture(stoppedStackFixture());
    const log = join(harness.stateDir, 'web.log');
    const lines = Array.from({ length: 60 }, (_, index) => `web log line ${index + 1}`);
    writeFileSync(log, `${lines.join('\n')}\n`);

    const following = harness.follow(['logs', '--json']);

    // The last 50 lines, then whatever is appended after following began.
    await following.until((out) => out.stderr.includes('web log line 60'), 'the initial tail');
    expect(following.output().stderr).not.toContain('web log line 10\n');
    appendFileSync(log, 'appended while following\n');
    await following.until(
      (out) => out.stderr.includes('appended while following'),
      'the appended line',
    );

    // A rewritten (truncated) log restarts at its new first line.
    writeFileSync(log, 'reborn after truncation\n');
    await following.until(
      (out) => out.stderr.includes('reborn after truncation'),
      'the rewritten log',
    );

    const result = await following.stop();
    const header = parseJsonObject(result.stdout);
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(header.log).toBe('.dev/web.log');
  });
});
