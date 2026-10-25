import { beforeEach, describe, expect, it, vi } from 'vitest';

const getByIdMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@admin/server/controllers/subscription-plan-admin.controller', () => ({
  subscriptionPlanAdminController: {
    getById: (...args: unknown[]) => getByIdMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));

vi.mock('@studiq/server/lib/http-utils', () => ({
  toNextResponse: (response: unknown) => response,
}));

const { DELETE, GET, PUT } =
  await import('@admin/app/(backend)/api/v1/subscription-plans/[id]/route');

const PLAN_ID = '5b1d6f6e-3f8e-4a1c-9b1e-2d6a4c7f8e90';

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/v1/subscription-plans/x', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin subscription-plans [id] route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getByIdMock.mockResolvedValue({ success: true, statusCode: 200, data: {} });
    updateMock.mockResolvedValue({ success: true, statusCode: 200, data: {} });
    deleteMock.mockResolvedValue({ success: true, statusCode: 200, data: { success: true } });
  });

  it('GET forwards the id segment to getById', async () => {
    await GET(
      new Request('http://localhost/api/v1/subscription-plans/x'),
      context({ id: PLAN_ID }),
    );

    expect(getByIdMock).toHaveBeenCalledWith(PLAN_ID);
  });

  it('PUT forwards the id segment and body to update', async () => {
    const body = { name: 'Renamed' };

    await PUT(jsonRequest(body), context({ id: PLAN_ID }));

    expect(updateMock).toHaveBeenCalledWith(PLAN_ID, body);
  });

  it('DELETE forwards the id segment to delete', async () => {
    await DELETE(
      new Request('http://localhost/api/v1/subscription-plans/x'),
      context({ id: PLAN_ID }),
    );

    expect(deleteMock).toHaveBeenCalledWith(PLAN_ID);
  });
});
