import type { ParsedCommand } from '../atoms';
import { EXIT_START_FAILED, EnvFailure } from '../lib/exit';
import { printJson, writeStderrLine } from '../lib/output';
import {
  localEnvFilePath,
  primaryCheckout,
  scaffoldLocalEnv,
  scaffoldVault,
  vaultFilePath,
  type ScaffoldResult,
} from '../lib/vault';
import { REPO_ROOT } from '../lib/repo';

interface SetupReport {
  envLocal: { path: string; result: ScaffoldResult | 'skipped' };
  vault: { path: string; primary: string; result: ScaffoldResult | 'skipped' };
}

/**
 * Human-only, mutating, idempotent onboarding scaffold.
 *
 * - Default: creates `.env.local` in this checkout (mode 600). `.env.local` is
 *   the only required hand-edited values file.
 * - `--vault`: creates the **optional** `.env.vault` ref file in the primary
 *   checkout (mode 600) for provider refs only (LLM/Stripe); it is never
 *   auto-created and the environment runs without it.
 *
 * Neither path writes a value: the scaffold is comments/empty refs only.
 * `--force` overwrites; without it an existing file is untouched.
 */
export async function runSetup(parsed: ParsedCommand): Promise<number> {
  const options = parsed.setup;
  if (!options) throw new EnvFailure(EXIT_START_FAILED, 'setup options are missing');
  const report: SetupReport = {
    envLocal: { path: localEnvFilePath(), result: 'skipped' },
    // `primaryCheckout()` shells out to `git worktree list`, so the vault fields
    // are resolved only when `--vault` scaffolds it; the default path keeps the
    // same report shape with empty paths.
    vault: { path: '', primary: '', result: 'skipped' },
  };

  if (options.vault) {
    const primary = primaryCheckout();
    report.vault = {
      path: vaultFilePath(),
      primary,
      result: scaffoldVault(REPO_ROOT, options.force),
    };
  } else {
    report.envLocal.result = scaffoldLocalEnv(REPO_ROOT, options.force);
  }

  if (parsed.json) {
    printJson(report);
    return 0;
  }
  if (!parsed.quiet) {
    if (options.vault) {
      writeStderrLine(
        `env: setup --vault — ${report.vault.result} ${report.vault.path} (mode 600, primary checkout: ${report.vault.primary})`,
      );
      writeStderrLine(
        '  fill the refs you use with varlock resolvers (LLM/Stripe only); never a literal',
      );
      writeStderrLine('  `.env.vault` is optional: a fresh checkout runs from .env.local alone.');
    } else {
      writeStderrLine(`env: setup — ${report.envLocal.result} ${report.envLocal.path} (mode 600)`);
      writeStderrLine(
        '  next: fill values in .env.local (see .env.schema), then `bun run env:verify`',
      );
      writeStderrLine('  provider refs are optional: `bun run env:setup --vault` scaffolds them');
    }
  }
  return 0;
}
