import { AccountType, type RequestContext } from '@studiq/authz';
import { SeatController } from '@studiq/server/controllers/seat.controller';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import type { SeatService } from '@studiq/server/services/seat.service';
import type { SubscriptionPlanService } from '@studiq/server/services/subscription-plan.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asService } from '#test/helpers/service-double';

function createMockService() {
  return {
    listPools: vi.fn(),
    addPool: vi.fn(),
    updatePool: vi.fn(),
    listAssignments: vi.fn(),
    assignSeat: vi.fn(),
    unassignSeat: vi.fn(),
  };
}

function createMockPlanService() {
  return {
    listLicencePlans: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let mockPlanService: ReturnType<typeof createMockPlanService>;
let controller: SeatController;
const mockCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.EDUCATOR,
  orgRoleId: 'role-admin',
  activeOrgId: 'org-1',
  url: '',
  method: 'GET',
  groupIds: [],
  // The Admin role's seat key; the refusal cases below replace this map.
  permissionScopes: { 'org.seat.manage': 'organization' },
};

/** The seeded Member role: in the org, no `org.*` key. */
const memberCtx: RequestContext = {
  ...mockCtx,
  accountType: AccountType.STUDENT,
  orgRoleId: 'role-member',
  permissionScopes: {},
};

describe('SeatController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    mockPlanService = createMockPlanService();
    controller = new SeatController(
      asService<SeatService>(mockService),
      asService<SubscriptionPlanService>(mockPlanService),
    );
  });

  describe('listLicencePlans', () => {
    it('returns the licence plans', async () => {
      mockPlanService.listLicencePlans.mockResolvedValueOnce({
        success: true,
        data: [{ key: 'ai_lite', name: 'StudiQ AI Lite' }],
      });
      const response = await controller.listLicencePlans(mockCtx);
      expect(response).toMatchObject({
        success: true,
        data: [{ key: 'ai_lite', name: 'StudiQ AI Lite' }],
      });
    });
    it('returns error on failure', async () => {
      mockPlanService.listLicencePlans.mockResolvedValueOnce({
        success: false,
        error: 'INTERNAL_SERVER',
      });
      const response = await controller.listLicencePlans(mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('listPools', () => {
    it('returns pools', async () => {
      mockService.listPools.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.listPools(mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.listPools.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });
      const response = await controller.listPools(mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('createPool', () => {
    it('creates a pool and returns 201', async () => {
      mockService.addPool.mockResolvedValueOnce({
        success: true,
        data: { id: 'p-1', planKey: 'pro', total: 10, assigned: 0 },
      });
      const response = await controller.createPool(mockCtx, {
        planKey: 'pro',
        quantity: 10,
      });
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.createPool(mockCtx, { planKey: '' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
    it('returns 422 when quantity exceeds the int4 range (#266)', async () => {
      const response = await controller.createPool(mockCtx, {
        planKey: 'campus',
        quantity: 99_999_999_999,
      });
      expect(response.success).toBe(false);
      if (response.success) return;
      expect(response.statusCode).toBe(422);
      expect(response.error).toBe('UNPROCESSABLE_ENTITY');
      expect(response.details?.[0]?.message).toBe(ValidationErrorCode.TOO_BIG);
      expect(response.details?.[0]?.path).toEqual(['quantity']);
    });
    it('forwards service details for the sum guard', async () => {
      mockService.addPool.mockResolvedValueOnce({
        success: false,
        error: 'UNPROCESSABLE_ENTITY',
        details: [{ code: 'custom', message: ValidationErrorCode.TOO_BIG, path: ['quantity'] }],
      });
      const response = await controller.createPool(mockCtx, {
        planKey: 'campus',
        quantity: 2_147_483_647,
      });
      expect(response.success).toBe(false);
      if (response.success) return;
      expect(response.statusCode).toBe(422);
      expect(response.details?.[0]?.path).toEqual(['quantity']);
    });
  });

  describe('updatePool', () => {
    it('updates a pool', async () => {
      mockService.updatePool.mockResolvedValueOnce({ success: true, data: { id: 'p-1' } });
      const response = await controller.updatePool(mockCtx, 'pool-1', { total: 10 });
      expect(response.success).toBe(true);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.updatePool(mockCtx, 'pool-1', { capacity: -1 });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
    it('returns 422 when total exceeds the int4 range', async () => {
      const response = await controller.updatePool(mockCtx, 'pool-1', { total: 99_999_999_999 });
      expect(response.success).toBe(false);
      if (response.success) return;
      expect(response.statusCode).toBe(422);
      expect(response.error).toBe('UNPROCESSABLE_ENTITY');
      expect(response.details?.[0]?.message).toBe(ValidationErrorCode.TOO_BIG);
    });
  });

  describe('listAssignments', () => {
    it('returns assignments', async () => {
      mockService.listAssignments.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.listAssignments(mockCtx);
      expect(response.success).toBe(true);
    });
  });

  describe('assignSeat', () => {
    it('assigns a seat', async () => {
      mockService.assignSeat.mockResolvedValueOnce({ success: true, data: { id: 'a-1' } });
      const response = await controller.assignSeat(mockCtx, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        poolId: '550e8400-e29b-41d4-a716-446655440001',
      });
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.assignSeat(mockCtx, { userId: 'bad' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('unassignSeat', () => {
    it('unassigns a seat', async () => {
      mockService.unassignSeat.mockResolvedValueOnce({ success: true, data: undefined });
      const response = await controller.unassignSeat(mockCtx, 'assignment-1');
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.unassignSeat.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.unassignSeat(mockCtx, 'nonexistent');
      expect(response.success).toBe(false);
    });
  });

  describe('org.seat.manage', () => {
    // One capability for the whole `/manage/seats` surface (ADR-0015 §4.1/§7):
    // the reads the page renders and every write. A Member-role holder is
    // refused on each, and the service is never reached.
    const calls = {
      listPools: () => controller.listPools(memberCtx),
      listLicencePlans: () => controller.listLicencePlans(memberCtx),
      createPool: () => controller.createPool(memberCtx, { planKey: 'pro', quantity: 1 }),
      updatePool: () => controller.updatePool(memberCtx, 'pool-1', { total: 1 }),
      listAssignments: () => controller.listAssignments(memberCtx),
      assignSeat: () =>
        controller.assignSeat(memberCtx, {
          userId: '550e8400-e29b-41d4-a716-446655440000',
          poolId: '550e8400-e29b-41d4-a716-446655440001',
        }),
      unassignSeat: () => controller.unassignSeat(memberCtx, 'assignment-1'),
    };

    it.each(Object.entries(calls))(
      '%s refuses a caller without org.seat.manage',
      async (_method, call) => {
        await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        expect(mockService.listPools).not.toHaveBeenCalled();
        expect(mockPlanService.listLicencePlans).not.toHaveBeenCalled();
        expect(mockService.addPool).not.toHaveBeenCalled();
        expect(mockService.updatePool).not.toHaveBeenCalled();
        expect(mockService.listAssignments).not.toHaveBeenCalled();
        expect(mockService.assignSeat).not.toHaveBeenCalled();
        expect(mockService.unassignSeat).not.toHaveBeenCalled();
      },
    );

    it('refuses a caller with no active org', async () => {
      await expect(
        controller.listPools({
          ...mockCtx,
          activeOrgId: null,
          orgRoleId: null,
          permissionScopes: {},
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockService.listPools).not.toHaveBeenCalled();
    });

    it('gates before the body is validated', async () => {
      // A 422 here would mean the schema ran before the gate; the refusal must
      // not depend on what an unauthorised caller sent.
      await expect(
        controller.createPool(memberCtx, { planKey: '', quantity: -1 }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockService.addPool).not.toHaveBeenCalled();
    });
  });
});
