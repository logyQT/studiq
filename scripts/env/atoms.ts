/** argv parsing for the lean `env` surface. */
import { EXIT_USAGE, EnvFailure } from './lib/exit';
import {
  PROFILE_NAMES,
  PROFILES,
  isCapabilityAtom,
  isProfileName,
  type CapabilityAtom,
  type ProfileName,
} from './profiles';

export type EnvCommand =
  'status' | 'doctor' | 'ports' | 'supa' | 'ensure' | 'down' | 'build' | 'help';

export type RuntimeChoice = 'native' | 'docker';
export type SeedMode = 'default' | 'seed' | 'no-seed';

export interface EnsureOptions {
  profile: ProfileName;
  capabilityAtoms: CapabilityAtom[];
  seed: SeedMode;
  build: boolean;
  serve: boolean;
  forceBuild: boolean;
  runtime: RuntimeChoice | null;
  stack: string | null;
  appPort: number | null;
  waitSeconds: number | null;
}

export interface DownOptions {
  all: boolean;
  stack: string | null;
}
export interface BuildOptions {
  force: boolean;
  stack: string | null;
}
export interface ParsedCommand {
  command: EnvCommand;
  json: boolean;
  passthrough: string[];
  ensure: EnsureOptions | null;
  down: DownOptions | null;
  build: BuildOptions | null;
  yes: boolean;
}

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

export const USAGE = [
  'Usage: bun run env:<command> [options]',
  '',
  '  env:ensure --profile <api|web> [--stack <name>] [--json]',
  '  env:status [--json]',
  '  env:down   [--all] [--stack <name>] [--yes] [--json]',
  '  env:build  [--force] [--stack <name>] [--json]',
  '  env:doctor [--json]',
  '  env:ports  [--json]',
  '  env:supa   <args…>',
  '',
  'Atoms: --db --rest --auth --storage --studio --mail --realtime --functions --analytics --seed --no-seed',
  '       --build --force-build --web --prod --runtime native|docker',
  '       --app-port <n> --wait <s> --json --yes',
].join('\n');

interface FlagToken {
  name: string;
  inline: string | undefined;
}
function flagToken(token: string): FlagToken {
  const equals = token.indexOf('=');
  return equals === -1
    ? { name: token, inline: undefined }
    : { name: token.slice(0, equals), inline: token.slice(equals + 1) };
}

const VALUE_FLAGS = new Set(['--profile', '--runtime', '--stack', '--app-port', '--wait']);

function readValue(token: string, inline: string | undefined, rest: string[], index: number) {
  if (inline !== undefined) {
    if (!inline) throw new UsageError(`'${token}' needs a value`);
    return { value: inline, next: index };
  }
  const value = rest[index + 1];
  if (value === undefined || value.startsWith('--'))
    throw new UsageError(`'${token}' needs a value`);
  return { value, next: index + 1 };
}

function parsePort(value: string): number {
  const port = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(`'${value}' is not a port (1-65535)`);
  }
  return port;
}

function parseWait(value: string): number {
  const seconds = /^[0-9]{1,4}$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new UsageError(`--wait='${value}' is out of range (1-3600)`);
  }
  return seconds;
}

function parseStackName(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new UsageError(`invalid stack name '${value}'`);
  return value;
}

function empty(command: EnvCommand): ParsedCommand {
  return {
    command,
    json: false,
    passthrough: [],
    ensure: null,
    down: null,
    build: null,
    yes: false,
  };
}

function parseRuntime(value: string): RuntimeChoice {
  if (value === 'native' || value === 'docker') return value;
  throw new UsageError(`unknown runtime '${value}'`);
}

function parseEnsure(rest: string[]): ParsedCommand {
  const parsed = empty('ensure');
  let profile: ProfileName | null = null;
  const atoms: CapabilityAtom[] = [];
  let seed: SeedMode = 'default';
  let buildAtom = false;
  let forceBuild = false;
  let prod = false;
  let webAtom = false;
  let runtime: RuntimeChoice | null = null;
  let stack: string | null = null;
  let appPort: number | null = null;
  let waitSeconds: number | null = null;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (token === '--help' || token === '-h') return empty('help');
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
            `unknown profile '${read.value}' (expected ${PROFILE_NAMES.join(' or ')})`,
          );
        }
        profile = read.value;
        break;
      }
      case '--seed':
        if (seed === 'no-seed') throw new UsageError("'--seed' conflicts with '--no-seed'");
        seed = 'seed';
        break;
      case '--no-seed':
        if (seed === 'seed') throw new UsageError("'--no-seed' conflicts with '--seed'");
        seed = 'no-seed';
        break;
      case '--build':
        buildAtom = true;
        break;
      case '--force-build':
        forceBuild = true;
        break;
      case '--web':
        webAtom = true;
        break;
      case '--prod':
        prod = true;
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
        appPort = parsePort(read.value);
        break;
      }
      case '--wait': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        waitSeconds = parseWait(read.value);
        break;
      }
      case '--json':
        parsed.json = true;
        break;
      case '--yes':
        parsed.yes = true;
        break;
      default: {
        const atom = name.slice(2);
        if (isCapabilityAtom(atom)) atoms.push(atom);
        else throw new UsageError(`unknown option '${name}' for 'ensure'`);
      }
    }
  }

  if (!profile) throw new UsageError("'ensure' needs '--profile <name>'");
  const spec = PROFILES[profile];
  if (webAtom && !prod) throw new UsageError("'--web' requires '--prod'");
  const build = spec.build || buildAtom || forceBuild || prod;
  const serve = spec.serve || prod;
  if ((build || serve) && !spec.build) {
    throw new UsageError(`profile '${profile}' does not build or serve`);
  }
  parsed.ensure = {
    profile,
    capabilityAtoms: atoms,
    seed,
    build,
    serve,
    forceBuild,
    runtime,
    stack,
    appPort,
    waitSeconds,
  };
  return parsed;
}

function parseDown(rest: string[]): ParsedCommand {
  const parsed = empty('down');
  let all = false;
  let stack: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (token === '--help' || token === '-h') return empty('help');
    if (!token.startsWith('--')) throw new UsageError(`unexpected argument '${token}' for 'down'`);
    const { name, inline } = flagToken(token);
    if (name === '--stack') {
      const read = readValue(name, inline, rest, index);
      index = read.next;
      stack = parseStackName(read.value);
      continue;
    }
    if (inline !== undefined) throw new UsageError(`'${name}' does not take a value`);
    switch (name) {
      case '--all':
        all = true;
        break;
      case '--yes':
        parsed.yes = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      default:
        throw new UsageError(`unknown option '${name}' for 'down'`);
    }
  }
  parsed.down = { all, stack };
  return parsed;
}

function parseBuild(rest: string[]): ParsedCommand {
  const parsed = empty('build');
  let force = false;
  let stack: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (token === '--help' || token === '-h') return empty('help');
    if (!token.startsWith('--')) throw new UsageError(`unexpected argument '${token}' for 'build'`);
    const { name, inline } = flagToken(token);
    if (name === '--stack') {
      const read = readValue(name, inline, rest, index);
      index = read.next;
      stack = parseStackName(read.value);
      continue;
    }
    if (inline !== undefined) throw new UsageError(`'${name}' does not take a value`);
    switch (name) {
      case '--force':
        force = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      default:
        throw new UsageError(`unknown option '${name}' for 'build'`);
    }
  }
  parsed.build = { force, stack };
  return parsed;
}

function parseFlagCommand(command: FlagCommand, rest: string[]): ParsedCommand {
  const parsed = empty(command);
  for (const arg of rest) {
    if (arg === '--help' || arg === '-h') return empty('help');
    if (!ALLOWED_FLAGS[command].includes(arg)) {
      throw new UsageError(`unknown option '${arg}' for '${command}'`);
    }
    parsed.json = true;
  }
  return parsed;
}

export function parseCommand(argv: string[]): ParsedCommand {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const [command, ...rest] = args;
  if (command === undefined) throw new UsageError('missing command');
  if (command === 'help' || command === '--help' || command === '-h') return empty('help');
  if (command === 'supa') {
    const parsed = empty('supa');
    parsed.passthrough = rest[0] === '--' ? rest.slice(1) : rest;
    return parsed;
  }
  if (command === 'ensure') return parseEnsure(rest);
  if (command === 'down') return parseDown(rest);
  if (command === 'build') return parseBuild(rest);
  if (!(FLAG_COMMANDS as ReadonlyArray<string>).includes(command)) {
    throw new UsageError(`unknown command '${command}'`);
  }
  return parseFlagCommand(command as FlagCommand, rest);
}
