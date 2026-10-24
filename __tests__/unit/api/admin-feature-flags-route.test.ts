import { beforeEach, describe, expect, it, vi } from 'vitest';

const getByIdMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@admin/server/controllers/feature-flag.controller', () => ({
  featureFlagController: {
    getById: (...args: unknown[]) => getByIdMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));

vi.mock('@studiq/server/lib/http-utils', () => ({
  toNextResponse: (response: unknown) => response,
}));

const { DELETE, GET, PUT } = await import('@admin/app/(backend)/api/v1/feature-flags/[id]/route');

const FLAG_ID = '334d8da1-1a77-4722-8d56-39d52f104ca4';

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/v1/feature-flags/x', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin feature-flags [id] route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getByIdMock.mockResolvedValue({ success: true, statusCode: 200, data: {} });
    updateMock.mockResolvedValue({ success: true, statusCode: 200, data: {} });
    deleteMock.mockResolvedValue({ success: true, statusCode: 200, data: { success: true } });
  });

  it('GET forwards the dynamic segment to getById', async () => {
    await GET(new Request('http://localhost/api/v1/feature-flags/x'), context({ id: FLAG_ID }));

    expect(getByIdMock).toHaveBeenCalledWith(FLAG_ID);
  });

  it('PUT forwards the dynamic segment and body to update', async () => {
    const body = { name: 'Branding', isEnabled: false, rolloutPercentage: 50 };

    await PUT(jsonRequest(body), context({ id: FLAG_ID }));

    expect(updateMock).toHaveBeenCalledWith(FLAG_ID, body);
  });

  it('DELETE forwards the dynamic segment to delete', async () => {
    await DELETE(new Request('http://localhost/api/v1/feature-flags/x'), context({ id: FLAG_ID }));

    expect(deleteMock).toHaveBeenCalledWith(FLAG_ID);
  });
});
