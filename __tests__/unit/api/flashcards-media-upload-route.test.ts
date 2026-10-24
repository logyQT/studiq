import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const uploadFileMock = vi.fn();
vi.mock('@studiq/server/services/storage.service', () => ({
  MAX_REQUEST_BYTES: 1024,
  storageService: { uploadFile: (...args: unknown[]) => uploadFileMock(...args) },
}));

let mockCtx: Record<string, unknown>;
vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (_req: unknown, handler: (ctx: unknown) => Promise<Response>) => handler(mockCtx),
}));

vi.mock('@studiq/server/lib/log', () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import { POST } from '@/app/(backend)/api/v1/flashcards/media/upload/route';

// Regression tests for the route-level contract of #185: oversize bodies are a
// 413 (not a 500), a truncated/malformed multipart body is a 400 (not a 500),
// and a valid file reaches the service untouched.
function fakeRequest(opts: {
  contentLength?: string;
  formData: () => Promise<FormData>;
}): NextRequest {
  return {
    headers: new Headers(opts.contentLength ? { 'content-length': opts.contentLength } : {}),
    formData: opts.formData,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx = { userId: 'user-1' };
});

describe('POST /api/v1/flashcards/media/upload (#185)', () => {
  it('returns 413 before parsing when Content-Length exceeds MAX_REQUEST_BYTES', async () => {
    const formData = vi.fn();
    const res = await POST(fakeRequest({ contentLength: '2048', formData: formData as never }));

    expect(res.status).toBe(413);
    expect(res.headers.get('x-error-code')).toBe('PAYLOAD_TOO_LARGE');
    expect(formData).not.toHaveBeenCalled();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('returns 400 (not 500) when the multipart body is malformed/truncated', async () => {
    const res = await POST(
      fakeRequest({
        contentLength: '10',
        formData: () => Promise.reject(new TypeError('Unexpected end of form')),
      }),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('x-error-code')).toBe('BAD_REQUEST');
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the form has no file', async () => {
    const res = await POST(fakeRequest({ formData: async () => new FormData() }));

    expect(res.status).toBe(400);
    expect(res.headers.get('x-error-code')).toBe('BAD_REQUEST');
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('forwards the file to the service and returns the storage url', async () => {
    uploadFileMock.mockResolvedValue({ url: 'https://storage.test/user-1/x.png' });
    const formData = new FormData();
    formData.append(
      'file',
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'x.png', {
        type: 'image/png',
      }),
    );
    const stored = formData.get('file');

    const res = await POST(fakeRequest({ contentLength: '64', formData: async () => formData }));

    expect(res.status).toBe(200);
    expect(uploadFileMock).toHaveBeenCalledWith('user-1', stored);
    expect(await res.json()).toEqual({
      success: true,
      data: { url: 'https://storage.test/user-1/x.png' },
    });
  });
});
