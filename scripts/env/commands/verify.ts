import { existsSync } from 'node:fs';
import type { ParsedCommand } from '../atoms';
import { EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { printJson, writeStderrLine } from '../lib/output';
import { loadVarlock } from '../lib/varlock';
import { localEnvFilePath, vaultFilePath } from '../lib/vault';
import { REPO_ROOT } from '../lib/repo';

interface VerifyReport {
  ok: boolean;
  envFile: boolean;
  vault: { present: boolean; status: 'available' | 'locked' | 'missing' | null };
  missingKeys: string[];
  nextAction: string;
}

/**
 * Read-only, agent-safe environment check.
 *
 * Default: `.env.local` + the schema only (fast, unauthenticated). `--full`
 * additionally resolves `.env.vault` refs and reports provider status. Only
 * key **names** are reported; varlock's output is never echoed (it is only
 * prefix-redacted), and no value is read into a log or the JSON contract.
 */
export async function runVerify(parsed: ParsedCommand): Promise<number> {
  const options = parsed.verify;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'verify options are missing');
  const envFile = localEnvFilePath();
  const vault = vaultFilePath();
  const vaultPresent = existsSync(vault);
  const paths = options.full && vaultPresent ? [vault, '.'] : null;
  const loaded = loadVarlock({ paths, root: REPO_ROOT });

  const missingKeys = [...loaded.items.entries()]
    .filter(([, item]) => !item.present)
    .map(([key]) => key)
    .sort();

  let vaultStatus: VerifyReport['vault']['status'] = null;
  if (options.full) {
    vaultStatus = !vaultPresent
      ? 'missing'
      : loaded.ok
        ? 'available'
        : (loaded.failure ?? 'missing');
  }

  const report: VerifyReport = {
    ok: loaded.ok,
    envFile: existsSync(envFile),
    vault: { present: vaultPresent, status: vaultStatus },
    missingKeys,
    nextAction: loaded.ok
      ? missingKeys.length > 0
        ? 'optional keys are unset; set them in .env.local only if this workflow needs them'
        : 'nothing to do'
      : 'fix the invalid values in .env.local (or the vault refs with --full); run `bun run env:setup` to scaffold',
  };

  if (parsed.json) {
    printJson(report);
  } else if (!parsed.quiet) {
    writeStderrLine(`env: verify — ${loaded.ok ? 'ok' : 'FAILED'}`);
    writeStderrLine(`  .env.local   ${report.envFile ? 'present' : 'missing (optional)'}`);
    if (options.full) {
      writeStderrLine(
        `  .env.vault   ${vaultPresent ? 'present' : 'missing (optional)'}  status=${vaultStatus}`,
      );
    }
    writeStderrLine(`  missing keys ${missingKeys.length > 0 ? missingKeys.join(', ') : '(none)'}`);
    writeStderrLine(`  next         ${report.nextAction}`);
  }

  return loaded.ok ? 0 : 1;
}
