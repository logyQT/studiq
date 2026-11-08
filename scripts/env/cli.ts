#!/usr/bin/env bun
/**
 * `env` CLI — phase 2: read-only commands plus `ensure` / `down` / `build`.
 *
 * `status`, `doctor` and `ports` are deliberately unwrapped: they read only the
 * process environment, the cross-checkout registry and `supabase stack status`,
 * so a locked vault never blocks them. The value-consuming commands
 * (`ensure`, `down`, `build`, `supa`) run under
 * `varlock run --inject vars --` (see root `package.json`), which is where
 * their values come from. No dotenv file is ever parsed here.
 *
 * Exit codes: 0 success/ready, 2 bad usage, 3 native unavailable, 4 start or
 * build failed, 5 timeout, 6 conflict. `doctor` also uses 1 when it finds a
 * real problem.
 */
import { parseCommand, USAGE, UsageError, type ParsedCommand } from './atoms';
import { runBuild } from './commands/build';
import { runDoctor } from './commands/doctor';
import { runDown } from './commands/down';
import { runEnsure } from './commands/ensure';
import { runPorts } from './commands/ports';
import { runStatus } from './commands/status';
import { runSupa } from './commands/supa';
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
