import { AppError } from '@studiq/server/lib/errors';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadToBucketMock = vi.fn();
vi.mock('@studiq/server/services/storage.service', () => ({
  storageService: { uploadToBucket: (...args: unknown[]) => uploadToBucketMock(...args) },
}));

const updateMock = vi.fn();
vi.mock('@studiq/server/controllers/organization.controller', () => ({
  organizationController: { update: (...args: unknown[]) => updateMock(...args) },
}));

const requireFeatureMock = vi.fn();
vi.mock('@studiq/server/lib/features', () => ({
  requireFeature: (...args: unknown[]) => requireFeatureMock(...args),
}));

let mockCtx: Record<string, unknown>;
vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (_req: unknown, handler: (ctx: unknown) => Promise<Response>) => handler(mockCtx),
}));

vi.mock('@studiq/server/lib/log', () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import { POST } from '@/app/(backend)/api/v1/organization/[id]/logo/route';

// Regression tests for the QA-visible contract of #273: a non-image upload
// (e.g. plain text renamed fake.png) must never reach storage, and a rejected
// upload must never overwrite `organizations.logo_url`.
function fakeRequest(formData: () => Promise<FormData>): NextRequest {
  return { formData } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: 'org-1' }) };

function imageFormData(): FormData {
  const formData = new FormData();
  formData.append(
    'file',
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' }),
  );
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx = {
    userId: 'user-1',
    accountType: 'MANAGER',
    activeOrgId: 'org-1',
    orgRoleId: 'role-1',
  };
});

describe('POST /api/v1/organization/[id]/logo (#273)', () => {
  it('returns 403 when the target org is not the active org', async () => {
    mockCtx = { ...mockCtx, activeOrgId: 'org-2' };

    const res = await POST(
      fakeRequest(async () => imageFormData()),
      params,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(uploadToBucketMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no org role', async () => {
    mockCtx = { ...mockCtx, orgRoleId: null };

    const res = await POST(
      fakeRequest(async () => imageFormData()),
      params,
    );

    expect(res.status).toBe(403);
    expect(uploadToBucketMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns 422 MISSING_FIELDS when the form has no file', async () => {
    const res = await POST(
      fakeRequest(async () => new FormData()),
      params,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ success: false, error: 'MISSING_FIELDS' });
    expect(uploadToBucketMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns 422 and keeps logo_url untouched when the bytes are not an image (issue #273 repro)', async () => {
    // The real service rejects plain text declared as image/png with this AppError
    // after sniffing the head bytes; the route must surface it and never persist.
    uploadToBucketMock.mockRejectedValue(new AppError('UNPROCESSABLE_ENTITY'));
    const formData = new FormData();
    formData.append(
      'file',
      new File([new TextEncoder().encode('this is not an image\n')], 'fake.png', {
        type: 'image/png',
      }),
    );

    const res = await POST(
      fakeRequest(async () => formData),
      params,
    );

    expect(res.status).toBe(422);
    expect(res.headers.get('x-error-code')).toBe('UNPROCESSABLE_ENTITY');
    expect(await res.json()).toEqual({ success: false, error: 'UNPROCESSABLE_ENTITY' });
    expect(uploadToBucketMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('persists the storage-returned url, not a client-supplied one', async () => {
    const url = 'https://storage.test/org-logos/org-1/x.png';
    uploadToBucketMock.mockResolvedValue({ url });
    updateMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: 'org-1', logoUrl: url },
    });

    const res = await POST(
      fakeRequest(async () => imageFormData()),
      params,
    );

    expect(res.status).toBe(200);
    expect(uploadToBucketMock).toHaveBeenCalledWith(
      'user-1',
      expect.any(File),
      'org-logos',
      'org-1',
    );
    expect(updateMock).toHaveBeenCalledWith(mockCtx, 'org-1', { logoUrl: url });
    expect(await res.json()).toEqual({ success: true, data: { id: 'org-1', logoUrl: url } });
  });

  it('requires the branding feature before uploading', async () => {
    uploadToBucketMock.mockResolvedValue({ url: 'https://storage.test/org-logos/org-1/x.png' });
    updateMock.mockResolvedValue({ success: true, statusCode: 200, data: { id: 'org-1' } });

    await POST(
      fakeRequest(async () => imageFormData()),
      params,
    );

    expect(requireFeatureMock).toHaveBeenCalledWith(mockCtx, 'branding');
    expect(requireFeatureMock.mock.invocationCallOrder[0]).toBeLessThan(
      uploadToBucketMock.mock.invocationCallOrder[0],
    );
  });
});
