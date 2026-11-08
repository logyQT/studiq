/**
 * argv parsing for the phase-1 `env` surface.
 *
 * Only the flags the read-only commands accept are defined here; every other
 * atom (`--profile`, `--runtime`, …) belongs to the lifecycle phases. `supa` is
 * a passthrough: its arguments are never interpreted by this tool.
 */

export type EnvCommand = 'status' | 'doctor' | 'ports' | 'supa' | 'help';

export interface ParsedCommand {
  command: EnvCommand;
  json: boolean;
  /** `supa` only: arguments forwarded verbatim to `bunx supabase`. */
  passthrough: string[];
}

/** A user error: reported on stderr and mapped to exit code 2. */
export class UsageError extends Error {}

const FLAG_COMMANDS = ['status', 'doctor', 'ports'] as const;

type FlagCommand = (typeof FLAG_COMMANDS)[number];

const ALLOWED_FLAGS: Record<FlagCommand, ReadonlyArray<string>> = {
  status: ['--json'],
  doctor: ['--json'],
  ports: ['--json'],
};

function isFlagCommand(value: string): value is FlagCommand {
  return (FLAG_COMMANDS as ReadonlyArray<string>).includes(value);
}

export const USAGE = [
  'Usage: bun run env:<command> [options]',
  '',
  '  env:status  [--json]   Web/Supabase health, stack identity, ports (read-only)',
  '  env:doctor  [--json]   Explain runtime/stack/registry problems (exit 1 on problems)',
  '  env:ports   [--json]   Print a free APP_PORT',
  '  env:supa    <args…>    Run `bunx supabase` with APP_URL exported (passthrough)',
  '',
  'status, doctor and ports are read-only: they read the process environment, the',
  'runtime registry and `supabase stack status` only. They never read a dotenv',
  'file and never print a secret. Use --json for the machine contract.',
].join('\n');

export function parseCommand(argv: string[]): ParsedCommand {
  const [command, ...rest] = argv;

  if (command === undefined) throw new UsageError('missing command');
  if (command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help', json: false, passthrough: [] };
  }

  if (command === 'supa') {
    // `bun run env:supa -- <args>` leaves one separator; `bun scripts/env/cli.ts
    // supa -- <args>` leaves none after bun strips it. Accept both.
    const passthrough = rest[0] === '--' ? rest.slice(1) : rest;
    return { command, json: false, passthrough };
  }

  if (!isFlagCommand(command)) throw new UsageError(`unknown command '${command}'`);

  let json = false;
  for (const arg of rest) {
    if (arg === '--help' || arg === '-h') {
      return { command: 'help', json: false, passthrough: [] };
    }
    const allowed = ALLOWED_FLAGS[command];
    if (!allowed.includes(arg)) {
      throw new UsageError(`unknown option '${arg}' for '${command}'`);
    }
    if (arg === '--json') json = true;
  }

  return { command, json, passthrough: [] };
}
