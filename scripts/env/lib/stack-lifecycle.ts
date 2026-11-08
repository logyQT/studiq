import { runSupabase, type StackEnv, type StackPorts } from './stack';
import { redactSecrets } from './output';
import type { Capability } from '../profiles';
import type { RuntimeChoice } from '../atoms';

/**
 * The only stack mutations the tool is allowed to perform: start (create or
 * resume), stop this checkout's stack, and reconcile in place. Nothing here
 * ever destroys data or touches another checkout's stack.
 */

export interface StartStackOptions {
  stackName: string | null;
  runtime: RuntimeChoice;
  excludes: readonly Capability[];
  /** A stack already exists, so observed ports are pinned (read-then-pin). */
  pinPorts: boolean;
  ports?: StackPorts;
  timeoutMs: number;
}

export interface StackActionResult {
  ok: boolean;
  timedOut: boolean;
  stderr: string;
}

function portArgs(ports: StackPorts | undefined): Record<string, string> {
  if (!ports) return {};
  const values: Record<string, string> = {};
  if (ports.api > 0) values.SUPABASE_API_PORT = String(ports.api);
  if (ports.db > 0) values.SUPABASE_DB_PORT = String(ports.db);
  if (ports.studio > 0) values.SUPABASE_STUDIO_PORT = String(ports.studio);
  if (ports.mail > 0) values.SUPABASE_LOCAL_SMTP_PORT = String(ports.mail);
  if (ports.mailSmtp > 0) values.SUPABASE_LOCAL_SMTP_SMTP_PORT = String(ports.mailSmtp);
  if (ports.mailPop3 > 0) values.SUPABASE_LOCAL_SMTP_POP3_PORT = String(ports.mailPop3);
  if (ports.analytics > 0) values.SUPABASE_ANALYTICS_PORT = String(ports.analytics);
  if (ports.edgeInspector > 0) {
    values.SUPABASE_EDGE_INSPECTOR_PORT = String(ports.edgeInspector);
  }
  if (ports.pooler > 0) values.SUPABASE_POOLER_PORT = String(ports.pooler);
  return values;
}

/**
 * Port variables inherited from a parent shell must not leak into a **cold**
 * start: the CLI would honour a stale fixed-port contract from another
 * checkout. A resume/reconcile pins the ports it just observed instead.
 */
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

function childEnv(options: StartStackOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of PORT_VARIABLES) delete env[name];
  if (options.pinPorts) Object.assign(env, portArgs(options.ports));
  return env;
}

export function startStack(options: StartStackOptions): StackActionResult {
  const args = ['stack', 'start', '--eager', '-x', options.excludes.join(',')];
  args.push('--runtime', options.runtime);
  if (options.stackName) args.push('--stack', options.stackName);
  args.push('--output-format', 'json');

  const result = runSupabase(args, { env: childEnv(options), timeoutMs: options.timeoutMs });
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

/**
 * Relay the discovered stack values to this process so `next build` and
 * `next start` children inline/serve the right stack. Values live in memory
 * and the child environment only.
 */
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
