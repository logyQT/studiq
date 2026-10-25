import { AppError } from '@studiq/server/lib/errors';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const LOGO_URL = `https://storage.test/org-logos/${ORG_ID}/logo.png`;

const uploadToBucketMock = vi.fn();
vi.mock('@studiq/server/services/storage.service', () => ({
  storageService: { uploadToBucket: (...args: unknown[]) => uploadToBucketMock(...args) },
}));

const updateMock = vi.fn();
const getByIdMock = vi.fn();
vi.mock('@studiq/server/controllers/organization.controller', () => ({
  organizationController: {
    update: (...args: unknown[]) => updateMock(...args),
    getById: (...args: unknown[]) => getByIdMock(...args),
  },
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

const { POST } = await import('@/app/(backend)/api/v1/organization/[id]/logo/route');

// Regression tests for the HTTP contract of #271: a rejected upload is a
// client/validation error (422/413/400) with `x-error-code`, never a bare
// 500 INTERNAL_SERVER. The 500 is reserved for real server faults.
function fakeRequest(formData: () => Promise<FormData>): NextRequest {
  return { formData } as unknown as NextRequest;
}

function context(id = ORG_ID) {
  return { params: Promise.resolve({ id }) };
}

function imageForm(type = 'image/png', name = 'logo.png'): FormData {
  const formData = new FormData();
  formData.append(
    'file',
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, {
      type,
    }),
  );
  return formData;
}

describe('POST /api/v1/organization/[id]/logo (#271)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = { userId: USER_ID, activeOrgId: ORG_ID, orgRoleId: 'role-manager' };
    requireFeatureMock.mockResolvedValue(undefined);
    // #281 reads the current row before uploading; these #271 cases start from
    // an org without a logo so the cleanup is a no-op.
    getByIdMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: ORG_ID, logo_url: null },
    });
  });

  it.each([
    ['text/plain', 'notes.txt'],
    ['image/svg+xml', 'icon.svg'],
  ])('maps a disallowed %s upload to 422 with x-error-code', async (type, name) => {
    uploadToBucketMock.mockRejectedValue(new AppError('UNPROCESSABLE_ENTITY'));

    const res = await POST(
      fakeRequest(async () => imageForm(type, name)),
      context(),
    );

    expect(res.status).toBe(422);
    expect(res.headers.get('x-error-code')).toBe('UNPROCESSABLE_ENTITY');
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'UNPROCESSABLE_ENTITY',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('maps an oversize upload to 413 with x-error-code and keeps the logo unchanged', async () => {
    uploadToBucketMock.mockRejectedValue(new AppError('PAYLOAD_TOO_LARGE'));

    const res = await POST(
      fakeRequest(async () => imageForm()),
      context(),
    );

    expect(res.status).toBe(413);
    expect(res.headers.get('x-error-code')).toBe('PAYLOAD_TOO_LARGE');
    await expect(res.json()).resolves.toEqual({ success: false, error: 'PAYLOAD_TOO_LARGE' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('still reports a genuine storage failure as 500 INTERNAL_SERVER', async () => {
    uploadToBucketMock.mockRejectedValue(new Error('boom'));

    const res = await POST(
      fakeRequest(async () => imageForm()),
      context(),
    );

    expect(res.status).toBe(500);
    expect(res.headers.get('x-error-code')).toBe('INTERNAL_SERVER');
    await expect(res.json()).resolves.toEqual({ success: false, error: 'INTERNAL_SERVER' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('maps a malformed multipart body to 400, not 500', async () => {
    const res = await POST(
      fakeRequest(() => Promise.reject(new TypeError('Unexpected end of form'))),
      context(),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('x-error-code')).toBe('BAD_REQUEST');
    expect(uploadToBucketMock).not.toHaveBeenCalled();
  });

  it('returns 422 MISSING_FIELDS when the form has no file', async () => {
    const res = await POST(
      fakeRequest(async () => new FormData()),
      context(),
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'MISSING_FIELDS' });
    expect(uploadToBucketMock).not.toHaveBeenCalled();
  });

  it('rejects an id that is not the active org', async () => {
    const res = await POST(
      fakeRequest(async () => imageForm()),
      context('22222222-2222-4222-8222-222222222222'),
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'FORBIDDEN' });
    expect(uploadToBucketMock).not.toHaveBeenCalled();
  });

  it('rejects a caller without an org role', async () => {
    mockCtx = { userId: USER_ID, activeOrgId: ORG_ID, orgRoleId: null };

    const res = await POST(
      fakeRequest(async () => imageForm()),
      context(),
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'FORBIDDEN' });
    expect(uploadToBucketMock).not.toHaveBeenCalled();
  });

  it('uploads a valid PNG to org-logos and persists the returned url', async () => {
    uploadToBucketMock.mockResolvedValue({ url: LOGO_URL });
    updateMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: ORG_ID, logoUrl: LOGO_URL },
    });
    const formData = imageForm();

    const res = await POST(
      fakeRequest(async () => formData),
      context(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: { id: ORG_ID, logoUrl: LOGO_URL },
    });
    expect(uploadToBucketMock).toHaveBeenCalledWith(
      USER_ID,
      formData.get('file'),
      'org-logos',
      ORG_ID,
    );
    expect(updateMock).toHaveBeenCalledWith(mockCtx, ORG_ID, { logoUrl: LOGO_URL });
  });
});
