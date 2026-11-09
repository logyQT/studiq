#!/usr/bin/env bun
/**
 * `env` CLI — phase 1 (read-only): status / doctor / ports / supa.
 *
 * `status`, `doctor` and `ports` are deliberately unwrapped: they read only the
 * process environment, the cross-checkout registry and `supabase stack status`,
 * so a locked vault never blocks them. `supa` is a passthrough and runs under
 * `varlock run --inject vars --` (see root `package.json`), which is where its
 * values come from. No dotenv file is ever parsed here.
 *
 * Exit codes: 0 success, 2 bad usage; `doctor` also uses 1 when it finds a real
 * problem. Lifecycle codes (3-6) belong to later phases.
 */
import { parseCommand, USAGE, UsageError, type ParsedCommand } from './atoms';
import { runDoctor } from './commands/doctor';
import { runPorts } from './commands/ports';
import { runStatus } from './commands/status';
import { runSupa } from './commands/supa';
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
      return 2;
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
