/**
 * argv parsing for the `env` surface.
 *
 * Phase 1 commands (`status`, `doctor`, `ports`, `supa`) stay read-only and
 * keep their flags. Phase 2 adds the lifecycle commands (`ensure`, `down`,
 * `build`) and the atom grammar from spec §3: a profile picks a capability set,
 * atoms only add capabilities, and impossible combinations are rejected here
 * with exit 2 instead of surfacing as a late CLI error.
 *
 * `supa` is a passthrough: its arguments are never interpreted by this tool.
 */
import { EXIT_USAGE, EnvFailure } from './lib/exit';
import {
  PROFILE_NAMES,
  PROFILES,
  ProfileError,
  buildCapabilities,
  isCapabilityAtom,
  isProfileName,
  type CapabilityAtom,
  type ProfileName,
} from './profiles';

export type EnvCommand =
  'status' | 'doctor' | 'ports' | 'supa' | 'ensure' | 'down' | 'build' | 'help';

export const RUNTIMES = ['native', 'docker'] as const;
export type RuntimeChoice = (typeof RUNTIMES)[number];

export type SeedMode = 'default' | 'seed' | 'no-seed' | 'reseed';

export interface EnsureOptions {
  profile: ProfileName;
  capabilityAtoms: CapabilityAtom[];
  seed: SeedMode;
  /** Build the app (profile default or `--build`/`--prod`). */
  build: boolean;
  /** Serve the production build (profile default or `--prod`). */
  serve: boolean;
  forceBuild: boolean;
  /** Explicit flag value; `null` means "resolve from `SUPABASE_RUNTIME`". */
  runtime: RuntimeChoice | null;
  stack: string | null;
  appPort: number | null;
  waitSeconds: number | null;
  reconcile: boolean;
}

export interface DownOptions {
  all: boolean;
}

export interface BuildOptions {
  force: boolean;
}

export interface ParsedCommand {
  command: EnvCommand;
  json: boolean;
  /** `supa` only: arguments forwarded verbatim to `bunx supabase`. */
  passthrough: string[];
  ensure: EnsureOptions | null;
  down: DownOptions | null;
  build: BuildOptions | null;
  yes: boolean;
  quiet: boolean;
  verbose: boolean;
}

/** A user error: reported on stderr and mapped to exit code 2. */
export class UsageError extends EnvFailure {
  constructor(message: string) {
    super(EXIT_USAGE, message);
    this.name = 'UsageError';
  }
}

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
  '  env:ensure  --profile <name> [atoms] [--json]   Idempotent start/build/serve',
  '  env:status  [--json]                           Web/Supabase health, stack identity (read-only)',
  '  env:down    [--all] [--yes] [--json]           Stop this web server; --all also the stack',
  '  env:build   [--force] [--json]                 Build @studiq/web (production)',
  '  env:doctor  [--json]                           Explain runtime/stack/registry problems',
  '  env:ports   [--json]                           Print a free APP_PORT',
  '  env:supa    <args…>                            Run `bunx supabase` with APP_URL exported',
  '',
  'Profiles (phase 2): api, web. The remaining profiles (db, mail, full, qa, e2e, admin)',
  'are declared but not reachable until phase 3.',
  '',
  'Atoms: --db --rest --auth --storage --studio --mail --functions --analytics',
  '       --realtime --pooler --seed --no-seed --reseed --reconcile --web --build',
  '       --force-build --prod --runtime <native|docker> --stack <name>',
  '       --app-port <n> --wait <s> --json --yes --quiet --verbose',
  '',
  '`--web` requires `--prod` (the tool never runs `next dev`). `--studio` requires',
  '`--rest`. Destructive commands need `--yes` when non-interactive. status, doctor',
  'and ports are read-only and never read a dotenv file.',
].join('\n');

interface FlagToken {
  name: string;
  inline: string | undefined;
}

function flagToken(token: string): FlagToken {
  const equals = token.indexOf('=');
  if (equals === -1) return { name: token, inline: undefined };
  return { name: token.slice(0, equals), inline: token.slice(equals + 1) };
}

const VALUE_FLAGS = new Set(['--profile', '--runtime', '--stack', '--app-port', '--wait']);

function readValue(
  token: string,
  inline: string | undefined,
  rest: string[],
  index: number,
): { value: string; next: number } {
  if (inline !== undefined) {
    if (inline === '') throw new UsageError(`'${token}' needs a value`);
    return { value: inline, next: index };
  }
  const value = rest[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`'${token}' needs a value`);
  }
  return { value, next: index + 1 };
}

function parsePort(value: string, flag: string): number {
  if (!/^[0-9]+$/.test(value))
    throw new UsageError(`${flag}='${value}' is not a port number (1-65535)`);
  const port = Number(value);
  if (port < 1 || port > 65535) throw new UsageError(`${flag}=${value} is out of range (1-65535)`);
  return port;
}

function parseWait(value: string): number {
  // Bound the digit count before Number(): a 310-digit string becomes Infinity.
  if (!/^[0-9]{1,4}$/.test(value)) {
    throw new UsageError(`--wait='${value}' is not a number of seconds (1-3600)`);
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new UsageError(`--wait='${value}' is out of range (1-3600)`);
  }
  return seconds;
}

function parseRuntime(value: string): RuntimeChoice {
  if (value === 'native' || value === 'docker') return value;
  if (value === 'podman') {
    throw new UsageError(
      "'podman' is not supported; choose '--runtime native' or '--runtime docker'",
    );
  }
  if (value === 'auto') {
    throw new UsageError("'auto' is not allowed: runtime selection is explicit ('native' default)");
  }
  throw new UsageError(`unknown runtime '${value}' (expected native or docker)`);
}

function parseStackName(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new UsageError(`--stack '${value}' is not a valid stack name (letters, digits, - and _)`);
  }
  return value;
}

function emptyParsed(command: EnvCommand): ParsedCommand {
  return {
    command,
    json: false,
    passthrough: [],
    ensure: null,
    down: null,
    build: null,
    yes: false,
    quiet: false,
    verbose: false,
  };
}

function helpResult(): ParsedCommand {
  return emptyParsed('help');
}

function parseEnsure(rest: string[]): ParsedCommand {
  const parsed = emptyParsed('ensure');
  let profile: ProfileName | null = null;
  const capabilityAtoms: CapabilityAtom[] = [];
  let seed: SeedMode = 'default';
  let webAtom = false;
  let prod = false;
  let buildAtom = false;
  let forceBuild = false;
  let runtime: RuntimeChoice | null = null;
  let stack: string | null = null;
  let appPort: number | null = null;
  let waitSeconds: number | null = null;
  let reconcile = false;

  const setSeed = (mode: SeedMode, flag: string): void => {
    if (seed !== 'default' && seed !== mode) {
      throw new UsageError(`${flag} conflicts with the earlier seeding flag`);
    }
    seed = mode;
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (token === '--help' || token === '-h') return helpResult();
    if (!token.startsWith('--')) throw new UsageError(`unexpected argument '${token}'`);
    const { name, inline } = flagToken(token);
    if (inline !== undefined && !VALUE_FLAGS.has(name)) {
      throw new UsageError(`'${name}' does not take a value`);
    }

    switch (name) {
      case '--profile': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        if (!isProfileName(read.value)) {
          throw new UsageError(
            `unknown profile '${read.value}' (expected one of: ${PROFILE_NAMES.join(', ')})`,
          );
        }
        profile = read.value;
        break;
      }
      case '--seed':
        setSeed('seed', name);
        break;
      case '--no-seed':
        setSeed('no-seed', name);
        break;
      case '--reseed':
        setSeed('reseed', name);
        break;
      case '--web':
        webAtom = true;
        break;
      case '--prod':
        prod = true;
        break;
      case '--build':
        buildAtom = true;
        break;
      case '--force-build':
        forceBuild = true;
        break;
      case '--reconcile':
        reconcile = true;
        break;
      case '--runtime': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        runtime = parseRuntime(read.value);
        break;
      }
      case '--stack': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        stack = parseStackName(read.value);
        break;
      }
      case '--app-port': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        appPort = parsePort(read.value, name);
        break;
      }
      case '--wait': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        waitSeconds = parseWait(read.value);
        break;
      }
      case '--admin':
        throw new UsageError("'--admin' is not available until phase 3 (admin build + serve)");
      case '--port-block':
        throw new UsageError("'--port-block' is not available until phase 4 (port allocator)");
      case '--json':
        parsed.json = true;
        break;
      case '--yes':
        parsed.yes = true;
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--verbose':
        parsed.verbose = true;
        break;
      default: {
        const atom = name.slice(2);
        if (isCapabilityAtom(atom)) {
          capabilityAtoms.push(atom);
          break;
        }
        throw new UsageError(`unknown option '${name}' for 'ensure'`);
      }
    }
  }

  if (!profile) throw new UsageError("'ensure' needs '--profile <name>'");
  const spec = PROFILES[profile];
  if (!spec.availableInPhase2) {
    throw new UsageError(
      `profile '${profile}' is not available until phase 3 (phase 2 implements 'api' and 'web')`,
    );
  }

  if (webAtom && !prod) {
    throw new UsageError(
      "'--web' requires '--prod': the tool never runs 'next dev' (that is human-only 'env:dev')",
    );
  }
  if (parsed.quiet && parsed.verbose) {
    throw new UsageError("'--quiet' and '--verbose' cannot be combined");
  }

  try {
    buildCapabilities(profile, capabilityAtoms);
  } catch (error) {
    if (error instanceof ProfileError) throw new UsageError(error.message);
    throw error;
  }

  const build = spec.build || buildAtom || forceBuild || prod;
  const serve = spec.serve || prod;
  if ((build || serve) && !spec.build) {
    throw new UsageError(
      `profile '${profile}' does not build or serve; use 'env:build' for an explicit build`,
    );
  }

  parsed.ensure = {
    profile,
    capabilityAtoms,
    seed,
    build,
    serve,
    forceBuild,
    runtime,
    stack,
    appPort,
    waitSeconds,
    reconcile,
  };
  return parsed;
}

function parseDown(rest: string[]): ParsedCommand {
  const parsed = emptyParsed('down');
  let all = false;
  for (const token of rest) {
    if (token === '--help' || token === '-h') return helpResult();
    if (token.startsWith('--') && token.includes('=')) {
      throw new UsageError(`'${token.split('=')[0]}' does not take a value`);
    }
    switch (token) {
      case '--all':
        all = true;
        break;
      case '--yes':
        parsed.yes = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--verbose':
        parsed.verbose = true;
        break;
      default:
        throw new UsageError(`unknown option '${token}' for 'down'`);
    }
  }
  if (parsed.quiet && parsed.verbose) {
    throw new UsageError("'--quiet' and '--verbose' cannot be combined");
  }
  parsed.down = { all };
  return parsed;
}

function parseBuild(rest: string[]): ParsedCommand {
  const parsed = emptyParsed('build');
  let force = false;
  for (const token of rest) {
    if (token === '--help' || token === '-h') return helpResult();
    if (token.startsWith('--') && token.includes('=')) {
      throw new UsageError(`'${token.split('=')[0]}' does not take a value`);
    }
    switch (token) {
      case '--force':
        force = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--verbose':
        parsed.verbose = true;
        break;
      default:
        throw new UsageError(`unknown option '${token}' for 'build'`);
    }
  }
  if (parsed.quiet && parsed.verbose) {
    throw new UsageError("'--quiet' and '--verbose' cannot be combined");
  }
  parsed.build = { force };
  return parsed;
}

function parseFlagCommand(command: FlagCommand, rest: string[]): ParsedCommand {
  const parsed = emptyParsed(command);
  for (const arg of rest) {
    if (arg === '--help' || arg === '-h') return helpResult();
    const allowed = ALLOWED_FLAGS[command];
    if (!allowed.includes(arg)) {
      throw new UsageError(`unknown option '${arg}' for '${command}'`);
    }
    if (arg === '--json') parsed.json = true;
  }
  return parsed;
}

export function parseCommand(argv: string[]): ParsedCommand {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const [command, ...rest] = args;

  if (command === undefined) throw new UsageError('missing command');
  if (command === 'help' || command === '--help' || command === '-h') return helpResult();

  if (command === 'supa') {
    // `bun run env:supa -- <args>` leaves one separator; `bun scripts/env/cli.ts
    // supa -- <args>` leaves none after bun strips it. Accept both.
    const passthrough = rest[0] === '--' ? rest.slice(1) : rest;
    const parsed = emptyParsed('supa');
    parsed.passthrough = passthrough;
    return parsed;
  }

  if (command === 'ensure') return parseEnsure(rest);
  if (command === 'down') return parseDown(rest);
  if (command === 'build') return parseBuild(rest);
  if (!isFlagCommand(command)) throw new UsageError(`unknown command '${command}'`);
  return parseFlagCommand(command, rest);
}
