import { createConsola } from 'consola';

const consola = createConsola({
  level: process.env.NODE_ENV === 'production' ? 1 : 5,
});

function writeLog(
  level: 'info' | 'warn' | 'error' | 'debug',
  namespace: string,
  message: string,
  opts?: {
    metadata?: Record<string, unknown>;
    durationMs?: number;
    conversationId?: string;
  },
) {
  const tag = `[${namespace.toUpperCase()}]`;
  const dur = opts?.durationMs != null ? ` (${Math.trunc(opts.durationMs)}ms)` : '';
  const meta = opts?.metadata ? ` ${JSON.stringify(opts.metadata)}` : '';
  consola[level](tag, `${message}${dur}${meta}`);
}

export function createLogger(namespace: string) {
  return {
    info: (message: string, opts?: Parameters<typeof writeLog>[3]) =>
      writeLog('info', namespace, message, opts),
    warn: (message: string, opts?: Parameters<typeof writeLog>[3]) =>
      writeLog('warn', namespace, message, opts),
    error: (message: string, opts?: Parameters<typeof writeLog>[3]) =>
      writeLog('error', namespace, message, opts),
    debug: (message: string, opts?: Parameters<typeof writeLog>[3]) =>
      writeLog('debug', namespace, message, opts),
    enabled: true,
  };
}

function createNoopLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, enabled: false };
}

const isTraceEnabled =
  process.env.NODE_ENV !== 'production' || process.env.TRACE_ENABLED === 'true';

export const log = {
  ai: createLogger('ai'),
  providers: createLogger('providers'),
  pdf: createLogger('pdf'),
  cache: createLogger('cache'),
  auth: createLogger('auth'),
  trace: isTraceEnabled ? createLogger('trace') : createNoopLogger(),
  api: createLogger('api'),
  system: createLogger('system'),
};
