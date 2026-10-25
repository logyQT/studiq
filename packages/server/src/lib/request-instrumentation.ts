import { context, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { AppError } from '@studiq/server/lib/errors';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { error as logError, warn as logWarn } from '@studiq/server/lib/log';
import {
  activeRequests,
  httpRequestDuration,
  httpRequestTotal,
} from '@studiq/server/lib/observability';
import type { NextRequest, NextResponse } from 'next/server';

export const TRACE_ID_HEADER = 'x-trace-id';
export const ERROR_CODE_HEADER = 'x-error-code';

/**
 * Query parameters that carry one-time credentials. `http.url` is the raw request
 * URL, so these must never reach Tempo/Loki — the auth callback receives
 * `token_hash` / `code` in the query string (#301).
 */
const SENSITIVE_QUERY_PARAMS = [
  'token_hash',
  'code',
  'access_token',
  'refresh_token',
  'token',
  'invite_token',
];

const REDACTED = '[REDACTED]';

/**
 * Returns `rawUrl` with the values of one-time credentials replaced by
 * `[REDACTED]`. Everything else (path, other parameters) is left untouched so
 * traces stay searchable by URL.
 */
export function redactSensitiveQuery(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Not an absolute URL: never leak a query string we cannot parse safely.
    const queryStart = rawUrl.indexOf('?');
    return queryStart === -1 ? rawUrl : `${rawUrl.slice(0, queryStart)}?${REDACTED}`;
  }

  let redacted = false;
  for (const param of SENSITIVE_QUERY_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.set(param, REDACTED);
      redacted = true;
    }
  }

  // `URL` normalizes the serialization; only pay the rewrite when needed so the
  // logged URL stays byte-identical to the request for ordinary routes.
  return redacted ? url.toString() : rawUrl;
}

export interface RequestInstrumentation {
  /** Real trace id from the request span — also returned in `x-trace-id`. */
  traceId: string;
  /** The request root span, so callers can attach their own attributes. */
  span: Span;
}

/** Every response gets the active trace id so a request maps to a Tempo trace. */
function attachTraceId(
  response: NextResponse | Response,
  traceId: string,
): NextResponse | Response {
  response.headers.set(TRACE_ID_HEADER, traceId);
  return response;
}

/**
 * The generic per-request observability lifecycle: root span, trace id, metrics,
 * 4xx/5xx logs and the standard error envelope. Shared by `withAuth` (which adds
 * authentication on top) and `withPublicTracing` (deliberately public routes).
 */
export async function withRequestInstrumentation(
  req: NextRequest,
  run: (instr: RequestInstrumentation) => Promise<NextResponse | Response>,
): Promise<NextResponse | Response> {
  const tracer = trace.getTracer('api');
  const span = tracer.startSpan(`${req.method} /api/**`, {
    attributes: {
      'http.method': req.method,
      'http.url': redactSensitiveQuery(req.url),
    },
  });

  // Real trace id from the span — returned in `x-trace-id` and used to look the
  // request up in Tempo.
  const traceId = span.spanContext().traceId;
  const metricLabels = { 'http.method': req.method };
  const t0 = performance.now();
  let statusCode = 500;

  activeRequests.add(1, metricLabels);

  // Settle a response: tag the trace id, set the span status from the HTTP
  // status, and emit a log for failures so 4xx/5xx land in Loki with the
  // trace_id (previously only thrown errors were logged — see #142).
  const settle = (
    response: NextResponse | Response,
    status: number,
    extraAttributes: Record<string, unknown> = {},
    exception?: unknown,
  ): NextResponse | Response => {
    statusCode = status;
    span.setAttribute('http.status_code', statusCode);

    const err =
      exception === undefined
        ? null
        : exception instanceof Error
          ? exception
          : new Error(String(exception));
    if (err) span.recordException(err);

    span.setStatus(
      statusCode >= 400
        ? {
            code: SpanStatusCode.ERROR,
            message: err ? `HTTP ${statusCode}: ${err.message}` : `HTTP ${statusCode}`,
          }
        : { code: SpanStatusCode.OK },
    );

    if (statusCode >= 400) {
      const errorCode = response.headers.get(ERROR_CODE_HEADER);
      const attributes = {
        'http.method': req.method,
        'http.url': redactSensitiveQuery(req.url),
        'http.status_code': statusCode,
        ...(errorCode ? { 'error.code': errorCode } : {}),
        ...extraAttributes,
      };
      const message = `API error ${statusCode}${errorCode ? ` ${errorCode}` : ''}`;
      if (statusCode >= 500) logError(message, attributes);
      else logWarn(message, attributes);
    }

    return attachTraceId(response, traceId);
  };

  try {
    // Run the whole request inside the span context so every response (including
    // early returns and the catch block) can be logged with this trace_id.
    return await context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const res = await run({ traceId, span });
        return settle(res, res.status);
      } catch (error) {
        if (error instanceof AppError) {
          return settle(
            toNextResponse({ success: false, statusCode: error.statusCode, error: error.code }),
            error.statusCode,
            {},
            error,
          );
        }

        if (error instanceof SyntaxError) {
          return settle(
            toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' }),
            400,
            {},
            error,
          );
        }

        return settle(
          toNextResponse({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' }),
          500,
          { error },
          error,
        );
      }
    });
  } finally {
    const duration = performance.now() - t0;
    span.setAttribute('duration.ms', duration);
    httpRequestDuration.record(duration, {
      'http.method': req.method,
      'http.status_code': statusCode,
    });
    httpRequestTotal.add(1, {
      'http.method': req.method,
      'http.status_code': statusCode,
    });
    activeRequests.add(-1, metricLabels);
    span.end();
  }
}
