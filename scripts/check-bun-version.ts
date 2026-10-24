#!/usr/bin/env bun
/**
 * Fail fast with upgrade instructions when the running Bun does not ship the
 * native toolchain the repo relies on:
 *   - `bun fmt`   (prettier-compatible formatter)
 *   - `bun check` (tsc-compatible type checker)
 *   - `bun lint`  (native linter; canary-only as of 1.4.4 stable)
 *
 * Stable 1.4.4 has fmt + check but not `lint`. Asking `bun lint` in a project
 * that has a `lint` script silently re-runs that script (infinite recursion),
 * so detection happens in an empty temp directory instead of the repo root.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIN = { major: 1, minor: 4, patch: 4 } as const;

function fail(message: string): never {
  console.error(`\n  x ${message}\n`);
  process.exit(1);
}

function parseVersion(raw: string): [number, number, number] {
  const [core] = raw.split('-');
  const [major = 0, minor = 0, patch = 0] = core.split('.').map(Number);
  return [major, minor, patch];
}

const [major, minor, patch] = parseVersion(Bun.version);
if (
  major < MIN.major ||
  (major === MIN.major && minor < MIN.minor) ||
  (major === MIN.major && minor === MIN.minor && patch < MIN.patch)
) {
  fail(
    `Bun ${Bun.version} is too old. This repo needs Bun >= 1.4.4 (canary while \`bun lint\` is canary-only).\n` +
      `    bun upgrade --canary\n` +
      `    # or: npm i -g bun@canary`,
  );
}

const probeDir = mkdtempSync(join(tmpdir(), 'studiq-bun-probe-'));
try {
  const probe = Bun.spawnSync([process.execPath, 'lint', '--no-script', '--help'], {
    cwd: probeDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = `${probe.stdout.toString()}${probe.stderr.toString()}`;
  if (probe.exitCode !== 0 || !output.includes('Usage: bun lint')) {
    fail(
      `Bun ${Bun.version} does not ship \`bun lint\`.\n` +
        `    Stable 1.4.4 has \`bun fmt\` and \`bun check\` but the linter is canary-only.\n` +
        `    bun upgrade --canary\n` +
        `    # or: npm i -g bun@canary`,
    );
  }
} finally {
  rmSync(probeDir, { recursive: true, force: true });
}
