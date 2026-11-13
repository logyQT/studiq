/** argv parsing for the `env` surface (spec §2/§3). */
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
  | 'status'
  | 'doctor'
  | 'ports'
  | 'supa'
  | 'ensure'
  | 'down'
  | 'build'
  | 'serve'
  | 'dev'
  | 'reset-db'
  | 'logs'
  | 'setup'
  | 'verify'
  | 'observability'
  | 'help';

export type RuntimeChoice = 'native' | 'docker';
export type SeedMode = 'default' | 'seed' | 'no-seed';

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
}

export interface DownOptions {
  all: boolean;
  stack: string | null;
}
export interface BuildOptions {
  force: boolean;
  stack: string | null;
}
export interface ServeOptions {
  stack: string | null;
}
export interface DevOptions {
  capabilityAtoms: CapabilityAtom[];
  runtime: RuntimeChoice | null;
  stack: string | null;
  waitSeconds: number | null;
}
export interface ResetDbOptions {
  stack: string | null;
}
export interface LogsOptions {
  follow: boolean;
  stack: string | null;
}
export interface SetupOptions {
  force: boolean;
  /** Scaffold the optional primary-checkout `.env.vault` ref file instead. */
  vault: boolean;
}
export interface VerifyOptions {
  full: boolean;
}

export interface ObservabilityOptions {
  mode: 'status' | 'ensure';
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
  serve: ServeOptions | null;
  dev: DevOptions | null;
  resetDb: ResetDbOptions | null;
  logs: LogsOptions | null;
  setup: SetupOptions | null;
  verify: VerifyOptions | null;
  observability: ObservabilityOptions | null;
  yes: boolean;
  /** Suppress informative stderr lines (`--quiet`). */
  quiet: boolean;
  /** Print extra diagnostics (`--verbose`). */
  verbose: boolean;
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
  '  env:ensure   --profile <name> [atoms] [--json]   Idempotent start/seed/build/serve',
  '  env:status   [--json]                           Web/Supabase health, stack identity (read-only)',
  '  env:down     [--all] [--stack <name>] [--yes]   Stop this web server; --all also the stack',
  '  env:build    [--force] [--json]                 Build @studiq/web (production)',
  '  env:serve    [--json]                           Serve the existing production build',
  '  env:dev      [atoms]                            Human-only `next dev` HMR (agents build + serve)',
  '  env:supa     <args…>                            Run `bunx supabase` with the contract exported',
  '  env:reset-db [--yes]                            Destructive: reset this checkout’s database',
  '  env:logs     [--no-follow]                      Stack logs + .dev/web.log',
  '  env:setup    [--force] [--vault]                Human-only: scaffold .env.local (or optional vault refs)',
  '  env:verify   [--full] [--json]                  Read-only env/schema check (names only)',
  '  env:observability [status|ensure] [--force]     Validate/mint the Grafana MCP token (read-only by default)',
  '  env:ports    [--json]                           Print a free APP_PORT',
  '  env:doctor   [--json]                           Explain runtime/stack/registry problems',
  '',
  `Profiles: ${PROFILE_NAMES.join(', ')} (web/qa/e2e build and serve; qa/e2e seed).`,
  '',
  'Atoms: --db --rest --auth --storage --studio --mail --realtime --functions --analytics',
  '       --seed --no-seed --web --build --force-build --prod',
  '       --runtime <native|docker> --stack <name> --app-port <n> --wait <s>',
  '       --json --yes --quiet --verbose',
  '',
  '`--web` requires `--prod` (the tool never runs `next dev` outside env:dev).',
  '`--studio` requires `--rest`. Destructive commands need `--yes` when',
  'non-interactive. status, ports and doctor never read a values file;',
  'verify loads .env.local through varlock and reports key names only.',
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
    serve: null,
    dev: null,
    resetDb: null,
    logs: null,
    setup: null,
    verify: null,
    observability: null,
    yes: false,
    quiet: false,
    verbose: false,
  };
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

/** Shared result flags accepted by every non-passthrough command. */
function parseCommon(parsed: ParsedCommand, name: string): boolean {
  if (name === '--json') {
    parsed.json = true;
    return true;
  }
  if (name === '--yes') {
    parsed.yes = true;
    return true;
  }
  if (name === '--quiet') {
    parsed.quiet = true;
    return true;
  }
  if (name === '--verbose') {
    parsed.verbose = true;
    return true;
  }
  return false;
}

interface EnsureDraft {
  profile: ProfileName | null;
  capabilityAtoms: CapabilityAtom[];
  seed: SeedMode;
  buildAtom: boolean;
  forceBuild: boolean;
  prod: boolean;
  webAtom: boolean;
  runtime: RuntimeChoice | null;
  stack: string | null;
  appPort: number | null;
  waitSeconds: number | null;
}

function parseEnsure(rest: string[]): ParsedCommand {
  const parsed = empty('ensure');
  const draft: EnsureDraft = {
    profile: null,
    capabilityAtoms: [],
    seed: 'default',
    buildAtom: false,
    forceBuild: false,
    prod: false,
    webAtom: false,
    runtime: null,
    stack: null,
    appPort: null,
    waitSeconds: null,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (token === '--help' || token === '-h') return empty('help');
    if (!token.startsWith('--')) throw new UsageError(`unexpected argument '${token}'`);
    const { name, inline } = flagToken(token);
    if (inline !== undefined && !VALUE_FLAGS.has(name)) {
      throw new UsageError(`'${name}' does not take a value`);
    }
    if (parseCommon(parsed, name)) continue;
    switch (name) {
      case '--profile': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        if (!isProfileName(read.value)) {
          throw new UsageError(
            `unknown profile '${read.value}' (expected ${PROFILE_NAMES.join(' or ')})`,
          );
        }
        draft.profile = read.value;
        break;
      }
      case '--seed':
        if (draft.seed === 'no-seed') throw new UsageError("'--seed' conflicts with '--no-seed'");
        draft.seed = 'seed';
        break;
      case '--no-seed':
        if (draft.seed === 'seed') throw new UsageError("'--no-seed' conflicts with '--seed'");
        draft.seed = 'no-seed';
        break;
      case '--build':
        draft.buildAtom = true;
        break;
      case '--force-build':
        draft.forceBuild = true;
        break;
      case '--web':
        draft.webAtom = true;
        break;
      case '--prod':
        draft.prod = true;
        break;
      case '--runtime': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        draft.runtime = parseRuntime(read.value);
        break;
      }
      case '--stack': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        draft.stack = parseStackName(read.value);
        break;
      }
      case '--app-port': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        draft.appPort = parsePort(read.value);
        break;
      }
      case '--wait': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        draft.waitSeconds = parseWait(read.value);
        break;
      }
      default: {
        const atom = name.slice(2);
        if (isCapabilityAtom(atom)) draft.capabilityAtoms.push(atom);
        else throw new UsageError(`unknown option '${name}' for 'ensure'`);
      }
    }
  }

  const profile = draft.profile;
  if (!profile) throw new UsageError("'ensure' needs '--profile <name>'");
  const spec = PROFILES[profile];
  if (draft.webAtom && !draft.prod) throw new UsageError("'--web' requires '--prod'");
  const build = spec.build || draft.buildAtom || draft.forceBuild || draft.prod;
  const serve = spec.serve || draft.prod;
  if ((build || serve) && !spec.build) {
    throw new UsageError(`profile '${profile}' does not build or serve`);
  }
  try {
    buildCapabilities(profile, draft.capabilityAtoms);
  } catch (error) {
    if (error instanceof ProfileError) throw new UsageError(error.message);
    throw error;
  }
  parsed.ensure = {
    profile,
    capabilityAtoms: draft.capabilityAtoms,
    seed: draft.seed,
    build,
    serve,
    forceBuild: draft.forceBuild,
    runtime: draft.runtime,
    stack: draft.stack,
    appPort: draft.appPort,
    waitSeconds: draft.waitSeconds,
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
    if (parseCommon(parsed, name)) continue;
    if (name === '--all') all = true;
    else throw new UsageError(`unknown option '${name}' for 'down'`);
  }
  parsed.down = { all, stack };
  return parsed;
}

/**
 * One loop for the single-stack commands. `flags` maps a value-less flag to its
 * handler; `--stack` takes a value and is handed to the finalizer.
 */
function parseSingle(
  command: EnvCommand,
  rest: string[],
  flags: Readonly<Record<string, () => void>>,
  finalize: (parsed: ParsedCommand, stack: string | null) => void,
  options: { allowStack?: boolean } = {},
): ParsedCommand {
  const parsed = empty(command);
  let stack: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (token === '--help' || token === '-h') return empty('help');
    if (!token.startsWith('--')) {
      throw new UsageError(`unexpected argument '${token}' for '${command}'`);
    }
    const { name, inline } = flagToken(token);
    if (name === '--stack' && options.allowStack !== false) {
      const read = readValue(name, inline, rest, index);
      index = read.next;
      stack = parseStackName(read.value);
      continue;
    }
    if (inline !== undefined) throw new UsageError(`'${name}' does not take a value`);
    const flag = flags[name];
    if (flag) {
      flag();
      continue;
    }
    if (parseCommon(parsed, name)) continue;
    throw new UsageError(`unknown option '${name}' for '${command}'`);
  }
  finalize(parsed, stack);
  return parsed;
}

function parseBuild(rest: string[]): ParsedCommand {
  let force = false;
  return parseSingle(
    'build',
    rest,
    { '--force': () => void (force = true) },
    (parsed, stack) => void (parsed.build = { force, stack }),
  );
}

function parseServe(rest: string[]): ParsedCommand {
  return parseSingle('serve', rest, {}, (parsed, stack) => void (parsed.serve = { stack }));
}

function parseResetDb(rest: string[]): ParsedCommand {
  return parseSingle('reset-db', rest, {}, (parsed, stack) => void (parsed.resetDb = { stack }));
}

function parseLogs(rest: string[]): ParsedCommand {
  let follow = true;
  return parseSingle(
    'logs',
    rest,
    { '--no-follow': () => void (follow = false) },
    (parsed, stack) => void (parsed.logs = { follow, stack }),
  );
}

function parseSetup(rest: string[]): ParsedCommand {
  let force = false;
  let vault = false;
  return parseSingle(
    'setup',
    rest,
    {
      '--force': () => void (force = true),
      '--vault': () => void (vault = true),
    },
    (parsed) => void (parsed.setup = { force, vault }),
    { allowStack: false },
  );
}

function parseVerify(rest: string[]): ParsedCommand {
  let full = false;
  return parseSingle(
    'verify',
    rest,
    { '--full': () => void (full = true) },
    (parsed) => void (parsed.verify = { full }),
    { allowStack: false },
  );
}

/**
 * `status` is read-only; `ensure` mints only when the token is missing or stale.
 * `--force` re-mints a token that still validates (manual recovery). Flags and
 * the mode may appear in any order: agents compose flags-first calls.
 */
function parseObservability(rest: string[]): ParsedCommand {
  const parsed = empty('observability');
  let mode: 'status' | 'ensure' = 'status';
  let explicitMode = false;
  let force = false;
  for (const token of rest) {
    if (token === '--help' || token === '-h') return empty('help');
    if (token === 'status' || token === 'ensure') {
      if (explicitMode && mode !== token) {
        throw new UsageError(`'observability' takes one mode, not '${mode}' and '${token}'`);
      }
      mode = token;
      explicitMode = true;
      continue;
    }
    if (!token.startsWith('--')) {
      throw new UsageError(`unexpected argument '${token}' for 'observability'`);
    }
    const { name, inline } = flagToken(token);
    if (inline !== undefined) throw new UsageError(`'${name}' does not take a value`);
    if (name === '--force') {
      force = true;
      continue;
    }
    if (parseCommon(parsed, name)) continue;
    throw new UsageError(`unknown option '${name}' for 'observability'`);
  }
  if (force && mode !== 'ensure') throw new UsageError("'--force' requires 'ensure'");
  parsed.observability = { mode, force };
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

/** `env:dev` takes the same stack/timing atoms as `ensure`, minus the profile. */
function parseDev(rest: string[]): ParsedCommand {
  const parsed = empty('dev');
  const capabilityAtoms: CapabilityAtom[] = [];
  let runtime: RuntimeChoice | null = null;
  let stack: string | null = null;
  let waitSeconds: number | null = null;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (token === '--help' || token === '-h') return empty('help');
    if (!token.startsWith('--')) throw new UsageError(`unexpected argument '${token}' for 'dev'`);
    const { name, inline } = flagToken(token);
    if (inline !== undefined && !VALUE_FLAGS.has(name)) {
      throw new UsageError(`'${name}' does not take a value`);
    }
    if (parseCommon(parsed, name)) continue;
    switch (name) {
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
      case '--wait': {
        const read = readValue(name, inline, rest, index);
        index = read.next;
        waitSeconds = parseWait(read.value);
        break;
      }
      case '--admin':
        throw new UsageError("'--admin' is deferred: run apps/admin's own dev command");
      default: {
        const atom = name.slice(2);
        if (isCapabilityAtom(atom)) capabilityAtoms.push(atom);
        else throw new UsageError(`unknown option '${name}' for 'dev'`);
      }
    }
  }
  parsed.dev = { capabilityAtoms, runtime, stack, waitSeconds };
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
  if (command === 'dev') return parseDev(rest);
  if (command === 'build') return parseBuild(rest);
  if (command === 'serve') return parseServe(rest);
  if (command === 'reset-db') return parseResetDb(rest);
  if (command === 'logs') return parseLogs(rest);
  if (command === 'setup') return parseSetup(rest);
  if (command === 'verify') return parseVerify(rest);
  if (command === 'observability') return parseObservability(rest);
  if (!(FLAG_COMMANDS as ReadonlyArray<string>).includes(command)) {
    throw new UsageError(`unknown command '${command}'`);
  }
  return parseFlagCommand(command as FlagCommand, rest);
}
