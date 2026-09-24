import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUsageMock = vi.fn();
const trackTokenUsageMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: {
    getUsage: (...args: unknown[]) => getUsageMock(...args),
    trackTokenUsage: (...args: unknown[]) => trackTokenUsageMock(...args),
  },
}));

const rateLimitCheckMock = vi.fn().mockReturnValue({ allowed: true });
vi.mock('@studiq/server/lib/rate-limiter', () => ({
  createRateLimiter: () => ({ check: (...args: unknown[]) => rateLimitCheckMock(...args) }),
}));

let capturedOnFinish: ((result: unknown) => void) | undefined;
let capturedStoreAtCallTime: unknown;
const streamTextMock = vi.fn((config: { onFinish?: (result: unknown) => void }) => {
  capturedOnFinish = config.onFinish;
  capturedStoreAtCallTime = conversationStorage.getStore();
  return { toUIMessageStreamResponse: () => new Response('stream', { status: 200 }) };
});
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: (config: { onFinish?: (result: unknown) => void }) => streamTextMock(config),
    convertToModelMessages: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('@studiq/server/lib/trace-queue', () => ({ enqueueTrace: vi.fn() }));

let mockCtx: Record<string, unknown>;
vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (
    _req: unknown,
    handler: (ctx: unknown) => Promise<Response>,
    _options?: unknown,
  ) => {
    try {
      return await handler(mockCtx);
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode ?? 500;
      const code = (error as { code?: string })?.code ?? 'INTERNAL_SERVER';
      return new Response(JSON.stringify({ success: false, error: code }), { status });
    }
  },
}));

import { conversationStorage } from '@studiq/server/lib/conversation-context';
import { POST } from '@/app/(backend)/api/v1/ai/chat/route';

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/v1/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/v1/ai/chat — token budget enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnFinish = undefined;
    capturedStoreAtCallTime = undefined;
    mockCtx = { userId: 'user-1', accountType: 'student', activeOrgId: null };
    rateLimitCheckMock.mockReturnValue({ allowed: true });
  });

  it('blocks with 429 before checking usage or calling the model when rate limited', async () => {
    rateLimitCheckMock.mockReturnValue({ allowed: false, retryAfterMs: 5000 });

    const res = await POST(
      jsonRequest({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('RATE_LIMITED');
    expect(body.retryAfterMs).toBe(5000);
    expect(getUsageMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('exposes the RequestContext to tool executions via conversationStorage', async () => {
    getUsageMock.mockResolvedValue({ current: 0, limit: 200000, plan: 'ace', resetsAt: '' });

    await POST(
      jsonRequest({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    );

    expect(capturedStoreAtCallTime).toEqual({
      conversationId: '1',
      requestContext: mockCtx,
    });
    expect(conversationStorage.getStore()).toBeUndefined();
  });

  it('blocks with 429 before calling the model when usage is at the limit', async () => {
    getUsageMock.mockResolvedValue({ current: 0, limit: 0, plan: 'base', resetsAt: '' });

    const res = await POST(
      jsonRequest({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('USAGE_LIMIT_EXCEEDED');
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('blocks when usage has already reached a positive limit', async () => {
    getUsageMock.mockResolvedValue({ current: 200000, limit: 200000, plan: 'ace', resetsAt: '' });

    const res = await POST(
      jsonRequest({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    );

    expect(res.status).toBe(429);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('allows the request through when usage is below the limit', async () => {
    getUsageMock.mockResolvedValue({ current: 100, limit: 200000, plan: 'ace', resetsAt: '' });

    const res = await POST(
      jsonRequest({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
  });

  it('never checks usage against the model for unlimited plans (-1)', async () => {
    getUsageMock.mockResolvedValue({ current: 999999, limit: -1, plan: 'sysadmin', resetsAt: '' });

    const res = await POST(
      jsonRequest({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledOnce();
  });

  it('records actual token usage via trackTokenUsage when the stream finishes', async () => {
    getUsageMock.mockResolvedValue({ current: 0, limit: 200000, plan: 'ace', resetsAt: '' });

    await POST(
      jsonRequest({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    );

    expect(capturedOnFinish).toBeDefined();
    capturedOnFinish!({
      steps: [],
      totalUsage: { inputTokens: 42, outputTokens: 17, totalTokens: 59 },
      finishReason: 'stop',
      text: 'ok',
    });

    await vi.waitFor(() => {
      expect(trackTokenUsageMock).toHaveBeenCalledWith(mockCtx, 42, 17);
    });
  });

  it('does not throw when totalUsage is missing from the finish result', async () => {
    getUsageMock.mockResolvedValue({ current: 0, limit: 200000, plan: 'ace', resetsAt: '' });

    await POST(
      jsonRequest({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    );

    expect(() => capturedOnFinish!({ steps: [], finishReason: 'stop', text: 'ok' })).not.toThrow();
    await vi.waitFor(() => {
      expect(trackTokenUsageMock).toHaveBeenCalledWith(mockCtx, 0, 0);
    });
  });
});
