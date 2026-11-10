import { runSupabase, type StackEnv } from './stack';
import { redactSecrets } from './output';
import type { Capability } from '../profiles';
import type { RuntimeChoice } from '../atoms';

export interface StackActionResult {
  ok: boolean;
  timedOut: boolean;
  stderr: string;
}

const PORT_VARIABLES = [
  'SUPABASE_API_PORT',
  'SUPABASE_DB_PORT',
  'SUPABASE_STUDIO_PORT',
  'SUPABASE_MAIL_PORT',
  'SUPABASE_LOCAL_SMTP_PORT',
  'SUPABASE_LOCAL_SMTP_SMTP_PORT',
  'SUPABASE_LOCAL_SMTP_POP3_PORT',
  'SUPABASE_ANALYTICS_PORT',
  'SUPABASE_EDGE_INSPECTOR_PORT',
  'SUPABASE_POOLER_PORT',
  'SUPABASE_SHADOW_PORT',
  'SUPABASE_DB_SHADOW_PORT',
  'SUPABASE_DB_POOLER_PORT',
] as const;

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

/** Relay discovered values to build/serve children; never log them. */
export function applyStackEnv(
  env: StackEnv,
  extras: { appUrl: string; appEnv: string; stackId?: string },
): void {
  process.env.APP_URL = extras.appUrl;
  process.env.APP_ENV = extras.appEnv;
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
  if (env.studioUrl) process.env.SUPABASE_STUDIO_URL = env.studioUrl;
  if (extras.stackId) process.env.SUPABASE_STACK_ID = extras.stackId;
  process.env.NEXT_PUBLIC_SITE_URL ||= extras.appUrl;
}
