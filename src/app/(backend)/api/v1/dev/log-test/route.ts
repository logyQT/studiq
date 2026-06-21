import { NextRequest } from 'next/server';
import { log, createLogger } from '@/lib/logger';

const VALID_LEVELS = ['info', 'warn', 'error', 'debug'] as const;
const VALID_NAMESPACES = ['ai', 'providers', 'pdf', 'cache', 'auth', 'trace', 'api', 'system'] as const;

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json({ error: 'Only available in development mode' }, { status: 403 });
  }

  const body = await req.json();
  const { level, namespace, message, metadata, durationMs, conversationId } = body;

  if (!level || !namespace || !message) {
    return Response.json({ error: 'Missing required fields: level, namespace, message' }, { status: 400 });
  }

  if (!VALID_LEVELS.includes(level)) {
    return Response.json({ error: `Invalid level. Must be one of: ${VALID_LEVELS.join(', ')}` }, { status: 400 });
  }

  const logger = (VALID_NAMESPACES as readonly string[]).includes(namespace)
    ? log[namespace as keyof typeof log]
    : createLogger(namespace);

  logger[level as 'info' | 'warn' | 'error' | 'debug'](message, {
    metadata: metadata ?? undefined,
    durationMs: durationMs ?? undefined,
    conversationId: conversationId ?? undefined,
  });

  return Response.json({ success: true });
}
