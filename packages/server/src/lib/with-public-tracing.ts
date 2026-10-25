import {
  type RequestInstrumentation,
  withRequestInstrumentation,
} from '@studiq/server/lib/request-instrumentation';
import type { NextRequest, NextResponse } from 'next/server';

export { ERROR_CODE_HEADER, TRACE_ID_HEADER } from '@studiq/server/lib/request-instrumentation';

/**
 * Observability for deliberately public routes (e.g. `/api/v1/auth/*`, #301).
 *
 * Unlike `withAuth` this performs **no** Supabase `getUser()` round-trip and
 * builds **no** `RequestContext`, so a public route can never start returning
 * 401/403 because of it. It only provides the documented request contract: a
 * root span, `x-trace-id` on every response, `http.server.*` metrics and
 * WARN/ERROR logs for 4xx/5xx.
 */
export function withPublicTracing(
  req: NextRequest,
  handler: (instr: RequestInstrumentation) => Promise<NextResponse | Response>,
): Promise<NextResponse | Response> {
  return withRequestInstrumentation(req, handler);
}
