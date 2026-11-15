import { batchActionRoute, type BatchActionHandler } from '@studiq/server/lib/batch-action-route';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The factory owns dispatch; the gate itself is covered by the with-auth specs.
vi.mock('@studiq/server/lib/with-auth', async () => {
  const { AccountType } = await import('@studiq/authz');
  return {
    withAuth: (_req: unknown, handler: (ctx: unknown) => unknown) =>
      handler({
        userId: 'user-1',
        accountType: AccountType.STUDENT,
        traceId: 'test',
        url: '',
        method: 'POST',
        activeOrgId: null,
        orgRoleId: null,
        groupIds: [],
        permissionScopes: {},
      }),
  };
});

const deleteHandler = vi.fn<BatchActionHandler>(() =>
  Promise.resolve({ success: true as const, statusCode: 200 }),
);
const restoreHandler = vi.fn<BatchActionHandler>(() =>
  Promise.resolve({ success: true as const, statusCode: 200 }),
);
const handlers: Record<string, BatchActionHandler> = {
  delete: deleteHandler,
  restore: restoreHandler,
};

function post(action: string, body: unknown = { ids: ['row-1'] }) {
  const route = batchActionRoute(handlers);
  return route(
    new NextRequest(`http://localhost/api/v1/x/batch/${action}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ action }) },
  );
}

describe('batchActionRoute', () => {
  beforeEach(() => {
    deleteHandler.mockClear();
    restoreHandler.mockClear();
  });

  it('dispatches a declared action with the parsed body', async () => {
    const response = await post('delete');

    expect(response.status).toBe(200);
    expect(deleteHandler).toHaveBeenCalledWith(
      { ids: ['row-1'] },
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('rejects an action that is not declared', async () => {
    const response = await post('archive');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'BAD_REQUEST' });
    expect(deleteHandler).not.toHaveBeenCalled();
  });

  /**
   * `handlers['constructor']` resolves `Object.prototype.constructor`, which is
   * truthy — the dispatch used to answer 200 and call `Object` with the body.
   */
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'rejects the inherited property %s',
    async (action) => {
      const response = await post(action);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: 'BAD_REQUEST' });
      expect(deleteHandler).not.toHaveBeenCalled();
      expect(restoreHandler).not.toHaveBeenCalled();
    },
  );
});
