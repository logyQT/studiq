import { AppError } from '@studiq/server/lib/errors';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the span withPublicTracing creates so we can assert attributes/end.
const { spanSpy, startSpanSpy } = vi.hoisted(() => {
  const spanSpy = {
    spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }),
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    addEvent: vi.fn(),
    updateName: vi.fn(),
    isRecording: () => true,
    end: vi.fn(),
  };
  const startSpanSpy = vi.fn(
    (_name: string, options?: { attributes?: Record<string, unknown> }) => {
      for (const [key, value] of Object.entries(options?.attributes ?? {})) {
        spanSpy.setAttribute(key, value);
      }
      return spanSpy;
    },
  );
  return { spanSpy, startSpanSpy };
});

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>();
  return {
    ...actual,
    trace: { ...actual.trace, getTracer: () => ({ startSpan: startSpanSpy }) },
  };
});

import { createClient } from '@studiq/server/lib/supabase/server';
import {
  ERROR_CODE_HEADER,
  TRACE_ID_HEADER,
  withPublicTracing,
} from '@studiq/server/lib/with-public-tracing';

function request(url = 'http://localhost/api/v1/auth/login') {
  return new NextRequest(url, { method: 'POST' });
}

describe('withPublicTracing — public request observability (#301)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns x-trace-id and preserves the controller x-error-code', async () => {
    const res = await withPublicTracing(request(), async () =>
      toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' }),
    );

    expect(res.status).toBe(401);
    expect(res.headers.get(TRACE_ID_HEADER)).toBe('a'.repeat(32));
    expect(res.headers.get(ERROR_CODE_HEADER)).toBe('UNAUTHORIZED');
  });

  it('settles a 401 returned by the handler without requiring auth', async () => {
    const handler = vi.fn(async () => new Response('nope', { status: 401 }));

    const res = await withPublicTracing(request(), handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
    expect(res.headers.get(TRACE_ID_HEADER)).toBeTruthy();
  });

  it('never calls createClient / getUser', async () => {
    await withPublicTracing(request(), async () => new Response('ok', { status: 200 }));

    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it('maps a thrown AppError to its status, code and trace id', async () => {
    const res = await withPublicTracing(request(), async () => {
      throw new AppError('FORBIDDEN');
    });

    expect(res.status).toBe(403);
    expect(res.headers.get(ERROR_CODE_HEADER)).toBe('FORBIDDEN');
    expect(res.headers.get(TRACE_ID_HEADER)).toBeTruthy();
    expect(await res.json()).toEqual({ success: false, error: 'FORBIDDEN' });
  });

  it('maps malformed JSON (SyntaxError) to 400 BAD_REQUEST', async () => {
    const req = new NextRequest('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });

    const res = await withPublicTracing(req, async () => {
      await req.json();
      return new Response('unreachable');
    });

    expect(res.status).toBe(400);
    expect(res.headers.get(ERROR_CODE_HEADER)).toBe('BAD_REQUEST');
    expect(res.headers.get(TRACE_ID_HEADER)).toBeTruthy();
  });

  it('maps a generic throw to 500 INTERNAL_SERVER with a trace id', async () => {
    const res = await withPublicTracing(request(), async () => {
      throw new Error('boom');
    });

    expect(res.status).toBe(500);
    expect(res.headers.get(ERROR_CODE_HEADER)).toBe('INTERNAL_SERVER');
    expect(res.headers.get(TRACE_ID_HEADER)).toBeTruthy();
    expect(spanSpy.recordException).toHaveBeenCalledTimes(1);
  });

  it('redacts one-time credentials from the span url and records the outcome', async () => {
    await withPublicTracing(
      request('http://localhost/api/v1/auth/callback?token_hash=SUPERSECRET&type=recovery'),
      async () => new Response(null, { status: 307 }),
    );

    expect(spanSpy.setAttribute).toHaveBeenCalledWith(
      'http.url',
      expect.stringContaining('token_hash=%5BREDACTED%5D'),
    );
    expect(spanSpy.setAttribute).toHaveBeenCalledWith(
      'http.url',
      expect.stringContaining('type=recovery'),
    );
    for (const call of spanSpy.setAttribute.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('SUPERSECRET');
    }
    expect(spanSpy.setAttribute).toHaveBeenCalledWith('http.status_code', 307);
    expect(spanSpy.setAttribute).toHaveBeenCalledWith('duration.ms', expect.any(Number));
    expect(spanSpy.end).toHaveBeenCalledTimes(1);
  });
});
