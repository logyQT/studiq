import {
  PORT_VARIABLES,
  runDatabaseCommand,
  runSupabase,
  type SpawnResult,
  type StackEnv,
} from './stack';
import { OTEL_ENDPOINT } from './observability';
import { redactSecrets } from './output';
import { currentBranchName, sanitizeProjectId } from './repo';
import type { Capability } from '../profiles';
import type { RuntimeChoice } from '../atoms';

export interface StackActionResult {
  ok: boolean;
  timedOut: boolean;
  stderr: string;
}

export function startStack(options: {
  stackName: string | null;
  runtime: RuntimeChoice;
  excludes: readonly Capability[];
  timeoutMs: number;
}): StackActionResult {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of PORT_VARIABLES) delete env[name];
  const args = ['stack', 'start', '--eager', '-x', options.excludes.join(',')];
  args.push('--runtime', options.runtime);
  if (options.stackName) args.push('--stack', options.stackName);
  args.push('--output-format', 'json');
  const result = runSupabase(args, { env, timeoutMs: options.timeoutMs });
  return {
    ok: result.status === 0,
    timedOut: result.timedOut,
    stderr: redactSecrets(result.stderr),
  };
}

export function stopStack(stackName: string | null, timeoutMs = 120_000): StackActionResult {
  const args = ['stack', 'stop', '--output-format', 'json'];
  if (stackName) args.push('--stack', stackName);
  const result = runSupabase(args, { timeoutMs });
  return {
    ok: result.status === 0,
    timedOut: result.timedOut,
    stderr: redactSecrets(result.stderr),
  };
}

export interface ResetDatabaseResult {
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
}

/**
 * `supabase db reset` for this checkout's stack.
 *
 * Only a named stack is addressed by its DB URL; the default stack keeps the
 * CLI's local target, which also applies the local migrations and seeds.
 */
export function resetDatabase(options: {
  stackName: string | null;
  dbUrl: string | null;
  timeoutMs?: number;
}): ResetDatabaseResult {
  if (options.stackName && !options.dbUrl) {
    return { ok: false, timedOut: false, exitCode: null };
  }
  const result = runDatabaseCommand(['db', 'reset', '--yes'], {
    dbUrl: options.stackName ? options.dbUrl : null,
    timeoutMs: options.timeoutMs ?? 300_000,
  });
  return { ok: result.status === 0, timedOut: result.timedOut, exitCode: result.status };
}

/** `supabase stack logs --tail <n>` for this checkout's stack. */
export function stackLogs(stackName: string | null, tail = 50): SpawnResult {
  const args = ['stack', 'logs', '--tail', String(tail)];
  if (stackName) args.push('--stack', stackName);
  return runSupabase(args, { timeoutMs: 60_000 });
}

/**
 * The per-checkout `service.name` for the machine-wide collector. A branch is
 * the natural discriminator (`studiq-feat-x`); a detached HEAD falls back to
 * the stack id. An explicit `OTEL_SERVICE_NAME` in `.env.local` still wins.
 *
 * @public Used by the env unit tests, which load this module by a computed URL.
 */
export function observabilityServiceName(branch: string, stackId?: string): string {
  const branchSlug = sanitizeProjectId(branch);
  if (branchSlug && branchSlug !== 'detached') return `studiq-${branchSlug}`;
  const stackSlug = sanitizeProjectId(stackId ?? '');
  return stackSlug ? `studiq-stack-${stackSlug.slice(0, 12)}` : 'studiq';
}

/** Relay discovered values to build/serve children; never log them. */
export function applyStackEnv(
  env: StackEnv,
  extras: { appUrl: string; appEnv: string; stackId?: string },
): void {
  process.env.APP_URL = extras.appUrl;
  process.env.APP_ENV = extras.appEnv;
  // One collector per machine: every checkout ships to the same OTLP intake,
  // but gets its own service name so Tempo/Loki/Prometheus can tell worktrees
  // apart. Never start a second observability stack from a worktree.
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||= OTEL_ENDPOINT;
  process.env.OTEL_SERVICE_NAME ||= observabilityServiceName(currentBranchName(), extras.stackId);
  process.env.SUPABASE_URL = env.apiUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.apiUrl;
  if (env.anonKey) {
    process.env.SUPABASE_ANON_KEY = env.anonKey;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
  }
  if (env.serviceRoleKey) process.env.SUPABASE_SERVICE_ROLE_KEY = env.serviceRoleKey;
  if (env.dbUrl) process.env.SUPABASE_DB_URL = env.dbUrl;
  if (env.mailUrl) {
    process.env.SUPABASE_MAIL_URL = env.mailUrl;
    process.env.MAILPIT_URL = env.mailUrl;
  }
  if (env.mailSmtpPort) process.env.MAILPIT_SMTP_PORT = String(env.mailSmtpPort);
  if (env.studioUrl) process.env.SUPABASE_STUDIO_URL = env.studioUrl;
  if (extras.stackId) process.env.SUPABASE_STACK_ID = extras.stackId;
  process.env.NEXT_PUBLIC_SITE_URL ||= extras.appUrl;
}
