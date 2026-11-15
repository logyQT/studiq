import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parseJsonObject } from '#test/unit/env/support';
import { loadEnvModule } from '#test/unit/env/load';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * `setup` scaffolds files in the real checkout, so the vault module is mocked:
 * the fakes record every path lookup. The default path must not resolve the
 * vault at all, because `primaryCheckout()` spawns `git worktree list`.
 */
const calls: string[] = [];
vi.doMock(join(REPO_ROOT, 'scripts/env/lib/vault.ts'), () => ({
  primaryCheckout: () => {
    calls.push('primaryCheckout');
    return '/primary';
  },
  vaultFilePath: () => {
    calls.push('vaultFilePath');
    return '/primary/.env.vault';
  },
  localEnvFilePath: () => '/checkout/.env.local',
  scaffoldLocalEnv: () => 'created',
  scaffoldVault: () => 'created',
}));

interface ParsedCommand {
  command: string;
  json: boolean;
}

interface SetupModule {
  runSetup(parsed: ParsedCommand): Promise<number>;
}

const setup = await loadEnvModule<SetupModule>('commands/setup.ts');
const atoms = await loadEnvModule<{ parseCommand(args: string[]): ParsedCommand }>('atoms.ts');

/** `--json` output is the report; capture it instead of letting it hit the terminal. */
async function runJson(args: string[]): Promise<Record<string, unknown>> {
  const chunks: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    expect(await setup.runSetup(atoms.parseCommand(args))).toBe(0);
  } finally {
    stdout.mockRestore();
  }
  return parseJsonObject(chunks.join(''));
}

describe('env:setup report', () => {
  it('leaves the vault unresolved in the default path', async () => {
    calls.length = 0;
    const report = await runJson(['setup', '--json']);
    // The shape stays stable for `--json` consumers; only the paths are omitted.
    expect(report).toMatchObject({
      envLocal: { path: '/checkout/.env.local', result: 'created' },
      vault: { path: '', primary: '', result: 'skipped' },
    });
    expect(calls).toEqual([]);
  });

  it('resolves the primary checkout for --vault', async () => {
    calls.length = 0;
    const report = await runJson(['setup', '--vault', '--json']);
    expect(report).toMatchObject({
      envLocal: { result: 'skipped' },
      vault: { path: '/primary/.env.vault', primary: '/primary', result: 'created' },
    });
    expect(calls).toEqual(['primaryCheckout', 'vaultFilePath']);
  });
});
