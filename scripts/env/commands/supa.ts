import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { UsageError } from '../atoms';
import { isSharedMode } from '../lib/contract';
import { writeStderrLine } from '../lib/output';
import { REPO_ROOT, canon } from '../lib/repo';
import { readStackList, type ListedStack } from '../lib/stack';

const ALL_MESSAGE =
  "env:supa: refusing 'stop --all' / 'restart --all' — it stops every Supabase stack " +
  "on the machine. Stop only this checkout's stack with 'stack stop --stack <name>'.";

const DESTROY_MESSAGE =
  "env:supa: refusing 'destroy' — stack deletion is owned by 'env:recreate --yes' / " +
  "'env:down --all --yes' (with ownership checks).";

const DB_RESET_MESSAGE =
  "env:supa: refusing 'db reset' — database reset is owned by 'env:reset-db --yes' " +
  "(this checkout's stack only).";

const NO_SCOPE_MESSAGE =
  "env:supa: 'stop'/'restart' requires --stack <name> or --stack-id <id>; " +
  'refusing an unscoped stack operation.';

interface StopScope {
  kind: 'name' | 'id';
  value: string;
}

type ScopeResolution = { stack: ListedStack } | { problem: string };

/**
 * Global flags that consume the next token as their value. Every one must be
 * skipped together with its value before the command position is read, or a
 * value like the `json` in `--output-format json stop` would be mistaken for
 * the command.
 */
const VALUE_FLAGS = new Set([
  '--output-format',
  '-o',
  '--output',
  '--workdir',
  '--stack',
  '--stack-id',
  '--profile',
  '--log-level',
  '--network-id',
  '--dns-resolver',
  '--agent',
  '--exclude',
  '-x',
  '--preparation',
  '--runtime',
  '--project-id',
  '--timeout',
  '--wait',
  '--port-block',
  '--app-port',
]);

/**
 * Boolean global flags. pflag also accepts a separated boolean value
 * (`true`/`false`, `yes`/`no`, `1`/`0`, `on`/`off`), which would otherwise be
 * read as the command.
 */
const BOOLEAN_FLAGS = new Set([
  '--debug',
  '--yes',
  '--experimental',
  '--frozen',
  '--wizard',
  '--json',
  '--quiet',
  '--verbose',
  '--version',
  '--help',
]);

const BOOLEAN_VALUES = new Set(['true', 'false', 'yes', 'no', '1', '0', 'on', 'off']);

/**
 * The CLI's command words (first two bare tokens), skipping flags and the values
 * of flags that take one (including a separated boolean value). `start --stack
 * stop` therefore has the command `start`; only a bare
 * `stop`/`restart`/`destroy` or `stack <verb>` is a guard target, and a stack
 * literally named `stop` stays a value.
 */
function commandWords(args: string[]): string[] {
  const words: string[] = [];
  for (let index = 0; index < args.length && words.length < 2; index += 1) {
    const token = args[index];
    if (!token) continue;
    if (token.startsWith('-')) {
      if (token.includes('=')) continue;
      if (VALUE_FLAGS.has(token)) {
        index += 1;
        continue;
      }
      if (BOOLEAN_FLAGS.has(token) && BOOLEAN_VALUES.has(args[index + 1] ?? '')) {
        index += 1;
      }
      continue;
    }
    words.push(token);
  }
  return words;
}

/** `--stack <name>`, `--stack=<name>`, `--stack-id <id>`, `--stack-id=<id>`. */
function stopScopes(args: string[]): StopScope[] {
  const scopes: StopScope[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--stack' || token === '--stack-id') {
      const value = args[index + 1];
      if (value && !value.startsWith('-')) {
        scopes.push({ kind: token === '--stack' ? 'name' : 'id', value });
      }
      index += 1;
      continue;
    }
    if (token?.startsWith('--stack=')) {
      scopes.push({ kind: 'name', value: token.slice('--stack='.length) });
    } else if (token?.startsWith('--stack-id=')) {
      scopes.push({ kind: 'id', value: token.slice('--stack-id='.length) });
    }
  }
  return scopes.filter((scope) => scope.value.length > 0);
}

function ownedByProblem(scope: StopScope, stack: ListedStack): string {
  const owner = stack.projectRoot || 'another checkout';
  return `env:supa: refusing to stop/restart stack '${scope.value}': it is owned by ${owner}, not this checkout (${REPO_ROOT}).`;
}

function notFoundProblem(scope: StopScope): string {
  const label = scope.kind === 'id' ? 'stack-id' : 'stack';
  return `env:supa: refusing to stop/restart ${label} '${scope.value}': not found in 'supabase stack list'.`;
}

/**
 * Resolve the requested scope against `stack list`, accepting a name or a
 * unique id prefix (matching what `supabase stack` accepts). Ownership is
 * checked here, before anything is spawned to stop.
 */
function resolveScope(stacks: ListedStack[], scope: StopScope): ScopeResolution {
  if (scope.kind === 'id') {
    const matches = stacks.filter(
      (stack) => stack.id === scope.value || stack.id.startsWith(scope.value),
    );
    if (matches.length === 0) return { problem: notFoundProblem(scope) };
    if (matches.length > 1) {
      return {
        problem: `env:supa: refusing to stop stack-id '${scope.value}': the prefix matches more than one stack.`,
      };
    }
    const stack = matches[0] as ListedStack;
    if (canon(stack.projectRoot) !== REPO_ROOT) return { problem: ownedByProblem(scope, stack) };
    return { stack };
  }

  const matches = stacks.filter((stack) => stack.name === scope.value);
  if (matches.length === 0) return { problem: notFoundProblem(scope) };
  const ours = matches.filter((stack) => canon(stack.projectRoot) === REPO_ROOT);
  if (ours.length === 0) {
    return { problem: ownedByProblem(scope, matches[0] as ListedStack) };
  }
  return { stack: ours[0] as ListedStack };
}

function reject(message: string, code: 2 | 6): number {
  writeStderrLine(message);
  return code;
}

/** `--workdir <path>` / `--workdir=<path>`, else `SUPABASE_WORKDIR`. */
function cliWorkdir(args: string[]): string | null {
  let workdir: string | null = process.env.SUPABASE_WORKDIR || null;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--workdir') {
      const value = args[index + 1];
      workdir = value && !value.startsWith('-') ? value : '';
      index += 1;
      continue;
    }
    if (token?.startsWith('--workdir=')) workdir = token.slice('--workdir='.length);
  }
  return workdir;
}

/** The CLI resolves `--workdir` relative to our cwd, which is the repo root. */
function isThisCheckout(workdir: string): boolean {
  return canon(workdir.startsWith('/') ? workdir : resolve(REPO_ROOT, workdir)) === REPO_ROOT;
}

/** `--all` and pflag's `--all=true|false` all mean "every stack". */
function hasAllFlag(args: string[]): boolean {
  return args.some((arg) => arg === '--all' || arg.startsWith('--all='));
}

/**
 * Passthrough to `bunx supabase` from the checkout root.
 *
 * `supabase/config.toml` resolves `APP_URL` through `env()`, and the CLI reads
 * no values file, so the resolved APP_URL is exported around the child. Values
 * come from the process environment (varlock injects them for this command);
 * an explicit APP_URL wins, exactly like `scripts/dev supa`.
 *
 * Guards (the command position is parsed apart from flag values, so
 * `start --stack stop` is not mistaken for a stop): under `SUPABASE_SHARED=1`
 * every stop-capable or destructive form is refused outright (this checkout
 * does not own the stack); otherwise `stop --all` / `restart --all` and a
 * `destroy` command are refused, `db reset` is refused, a `stop`/`restart`
 * must name a stack this checkout owns, and a `--workdir`/`SUPABASE_WORKDIR`
 * must resolve to this checkout's root (otherwise the CLI could operate on
 * another checkout's stack). Usage errors exit 2, ownership conflicts 6, and
 * nothing is ever written to stdout.
 */
export function runSupa(args: string[]): number {
  const [first, second] = commandWords(args);
  const stopCapable =
    first === 'stop' ||
    first === 'restart' ||
    (first === 'stack' && (second === 'stop' || second === 'restart'));
  const destroyCommand = first === 'destroy' || (first === 'stack' && second === 'destroy');
  const dbReset = first === 'db' && second === 'reset';
  const migrationDown = first === 'migration' && second === 'down';
  const storageRm = first === 'storage' && second === 'rm';
  const mutating = stopCapable || destroyCommand || dbReset || migrationDown || storageRm;

  // Shared mode disables every stack mutation: refuse before any ownership
  // check or spawn, naming the checkout that actually owns the stack. The flag
  // is parsed strictly (''/'0'/'1'), so an invalid value like `true` is a usage
  // error instead of silently allowing a mutation to forward.
  if (mutating) {
    let shared: boolean;
    try {
      shared = isSharedMode();
    } catch (error) {
      if (error instanceof UsageError) return reject(`env:supa: ${error.message}`, 2);
      throw error;
    }
    if (shared) {
      const owner = process.env.SUPABASE_SHARED_OWNER || 'owner unknown';
      const command = [first, second].filter(Boolean).join(' ');
      return reject(
        `env:supa: refusing '${command}' under SUPABASE_SHARED=1 — this checkout does not own ` +
          `the stack (owner: ${owner}); run it in the owning checkout.`,
        6,
      );
    }
  }

  if (stopCapable && hasAllFlag(args)) return reject(ALL_MESSAGE, 2);
  if (destroyCommand) return reject(DESTROY_MESSAGE, 2);
  if (dbReset) return reject(DB_RESET_MESSAGE, 2);

  if (stopCapable) {
    // The CLI resolves a stack against `--workdir`, so approving a local stack
    // name is not enough: a foreign workdir could make it stop another
    // checkout's stack. Only this checkout's root is accepted.
    const workdir = cliWorkdir(args);
    if (workdir !== null && (workdir === '' || !isThisCheckout(workdir))) {
      return reject(
        `env:supa: refusing to stop/restart: --workdir '${workdir || '(empty)'}' is not this checkout (${REPO_ROOT}).`,
        6,
      );
    }

    const scopes = stopScopes(args);
    if (scopes.length === 0) return reject(NO_SCOPE_MESSAGE, 2);

    const stacks = readStackList();
    if (!stacks) {
      return reject(
        `env:supa: refusing to stop/restart '${scopes[0]?.value ?? ''}': cannot read 'supabase stack list' to verify ownership.`,
        6,
      );
    }

    const targets = new Set<string>();
    for (const scope of scopes) {
      const resolution = resolveScope(stacks, scope);
      if ('problem' in resolution) return reject(resolution.problem, 6);
      targets.add(resolution.stack.id);
    }
    if (targets.size > 1) {
      return reject(
        "env:supa: refusing to stop/restart: '--stack' and '--stack-id' name different stacks.",
        6,
      );
    }
  }

  const appUrl = process.env.APP_URL || `http://localhost:${process.env.APP_PORT || '3000'}`;
  const result = spawnSync('bunx', ['supabase', ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, APP_URL: appUrl },
    stdio: 'inherit',
  });

  if (result.error) {
    writeStderrLine(`env:supa: cannot run bunx: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
