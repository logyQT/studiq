import { AccountType } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

// Capture the span withAuth creates so we can assert recordException/setStatus.
const { spanSpy } = vi.hoisted(() => ({
  spanSpy: {
    spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }),
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    addEvent: vi.fn(),
    updateName: vi.fn(),
    isRecording: () => true,
    end: vi.fn(),
  },
}));

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>();
  return {
    ...actual,
    trace: { ...actual.trace, getTracer: () => ({ startSpan: () => spanSpy }) },
  };
});

import { withAuth } from '@studiq/server/lib/with-auth';

function request() {
  return new NextRequest('http://localhost/api/v1/example', { method: 'GET' });
}

describe('withAuth root span exceptions', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    mock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { account_type: AccountType.STUDENT } } },
    });
  });

  it.each([
    ['AppError', () => new AppError('FORBIDDEN')],
    ['SyntaxError', () => new SyntaxError('unexpected token')],
    ['generic Error', () => new Error('boom')],
  ])('records the exception on the root span for a thrown %s', async (_label, make) => {
    await withAuth(request(), async () => {
      throw make();
    });

    expect(spanSpy.recordException).toHaveBeenCalledTimes(1);
    expect(spanSpy.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ code: 2, message: expect.stringContaining('HTTP') }),
    );
  });

  it('does not record an exception for a returned error response', async () => {
    await withAuth(request(), async () =>
      toNextResponse({ success: false, statusCode: 404, error: 'NOT_FOUND' }),
    );

    expect(spanSpy.recordException).not.toHaveBeenCalled();
  });
});
