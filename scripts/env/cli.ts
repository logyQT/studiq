#!/usr/bin/env bun
/**
 * `env` CLI — one command surface for the local environment.
 *
 * `status`, `doctor` and `ports` are deliberately unwrapped *and* read-only:
 * they read only the process environment, the cross-checkout registry and
 * `supabase stack status`, so a locked vault never blocks them. `setup` and
 * `verify` are unwrapped too, but they do touch the root `.env.local` — `setup`
 * scaffolds it, `verify` loads it through `varlock` (names/presence only). The
 * value-consuming commands (`ensure`, `serve`, `build`, `dev`, `down`,
 * `reset-db`, `logs`, `supa`) run under `varlock run --inject vars --` (see
 * `scripts/env/varlock-run.sh` and root `package.json`), which is where their
 * values come from. The CLI itself never parses a dotenv file.
 *
 * Exit codes: 0 success/ready, 1 doctor found a problem (and verify cannot read
 * the schema), 2 bad usage, 3 native unavailable, 4 start or build failed, 5
 * timeout, 6 conflict.
 */
import { parseCommand, USAGE, UsageError, type ParsedCommand } from './atoms';
import { runBuild } from './commands/build';
import { runDev } from './commands/dev';
import { runDoctor } from './commands/doctor';
import { runDown } from './commands/down';
import { runEnsure } from './commands/ensure';
import { runLogs } from './commands/logs';
import { runObservability } from './commands/observability';
import { runPorts } from './commands/ports';
import { runResetDb } from './commands/reset-db';
import { runServe } from './commands/serve';
import { runSetup } from './commands/setup';
import { runStatus } from './commands/status';
import { runSupa } from './commands/supa';
import { runVerify } from './commands/verify';
import { EnvFailure } from './lib/exit';
import { writeLine, writeStderrLine } from './lib/output';

async function dispatch(parsed: ParsedCommand): Promise<number> {
  switch (parsed.command) {
    case 'help':
      writeLine(USAGE);
      return 0;
    case 'status':
      return runStatus(parsed);
    case 'doctor':
      return runDoctor(parsed);
    case 'ports':
      return runPorts(parsed);
    case 'supa':
      return runSupa(parsed.passthrough);
    case 'ensure':
      return runEnsure(parsed);
    case 'down':
      return runDown(parsed);
    case 'build':
      return runBuild(parsed);
    case 'serve':
      return runServe(parsed);
    case 'dev':
      return runDev(parsed);
    case 'reset-db':
      return runResetDb(parsed);
    case 'logs':
      return runLogs(parsed);
    case 'setup':
      return runSetup(parsed);
    case 'verify':
      return runVerify(parsed);
    case 'observability':
      return runObservability(parsed);
  }
}

async function main(argv: string[]): Promise<number> {
  try {
    return await dispatch(parseCommand(argv));
  } catch (error) {
    if (error instanceof UsageError) {
      writeStderrLine(`env: ${error.message}`);
      writeStderrLine();
      writeStderrLine(USAGE);
      return error.exitCode;
    }
    if (error instanceof EnvFailure) {
      writeStderrLine(`env: ${error.message}`);
      return error.exitCode;
    }
    throw error;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  writeStderrLine(`env: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
