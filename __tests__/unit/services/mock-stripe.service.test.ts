import { MockStripeService } from '@studiq/server/services/mock-stripe.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

const studentPlan = { key: 'spark', is_active: true, for_account_type: 'student' };
const orgPlan = { key: 'campus', is_active: true, for_account_type: 'manager' };
const anyPlan = { key: 'free', is_active: true, for_account_type: null };
const inactivePlan = { key: 'old', is_active: false, for_account_type: 'student' };

const adminMembership = { org_roles: { name: 'admin' } };
const teacherMembership = { org_roles: { name: 'teacher' } };

const event = {
  type: 'checkout.session.completed',
  session_id: 's-1',
  plan_id: 'spark',
  user_id: 'u-1',
};

describe('MockStripeService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: MockStripeService;
  let admin: { rpc: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    admin = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    service = new MockStripeService(
      async () => mock as any,
      () => admin as any,
    );
  });

  describe('createCheckoutSession', () => {
    it('creates a session for a plan matching the account type', async () => {
      mock.from.mockReturnValueOnce(qb(studentPlan));
      const result = await service.createCheckoutSession('spark', 'student', 'u-1');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.url).toContain('plan_id=spark');
    });

    it('allows a plan that is not tied to an account type', async () => {
      mock.from.mockReturnValueOnce(qb(anyPlan));
      const result = await service.createCheckoutSession('free', 'educator', 'u-1');
      expect(result.success).toBe(true);
    });

    it('rejects an unknown plan', async () => {
      mock.from.mockReturnValueOnce(qb(null));
      const result = await service.createCheckoutSession('nope', 'student', 'u-1');
      expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
    });

    it('rejects an inactive plan', async () => {
      mock.from.mockReturnValueOnce(qb(inactivePlan));
      const result = await service.createCheckoutSession('old', 'student', 'u-1');
      expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
    });

    it('rejects a plan meant for another account type (#192)', async () => {
      mock.from.mockReturnValueOnce(qb(orgPlan));
      const result = await service.createCheckoutSession('campus', 'student', 'u-1');
      expect(result).toEqual({ success: false, error: 'FORBIDDEN' });
    });
  });

  describe('organization plans (#177)', () => {
    const orgEvent = { ...event, plan_id: 'campus', org_id: 'org-1' };

    it('creates a session carrying the org id for an org admin', async () => {
      mock.from.mockReturnValueOnce(qb(orgPlan)).mockReturnValueOnce(qb(adminMembership));
      const result = await service.createCheckoutSession('campus', 'manager', 'u-1', 'org-1');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.url).toContain('org_id=org-1');
    });

    it('requires an org id to start an org plan checkout', async () => {
      mock.from.mockReturnValueOnce(qb(orgPlan));
      const result = await service.createCheckoutSession('campus', 'manager', 'u-1');
      expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
    });

    it('refuses a checkout for an org the caller does not administer', async () => {
      mock.from.mockReturnValueOnce(qb(orgPlan)).mockReturnValueOnce(qb(teacherMembership));
      const result = await service.createCheckoutSession('campus', 'manager', 'u-1', 'org-1');
      expect(result).toEqual({ success: false, error: 'FORBIDDEN' });
    });

    it('refuses a checkout for an org the caller is not a member of', async () => {
      mock.from.mockReturnValueOnce(qb(orgPlan)).mockReturnValueOnce(qb(null));
      const result = await service.createCheckoutSession('campus', 'manager', 'u-1', 'org-9');
      expect(result).toEqual({ success: false, error: 'FORBIDDEN' });
    });

    it('moves the org to the plan (re-syncing features and limits) and the buyer personal plan', async () => {
      const profiles = qb(null);
      mock.from
        .mockReturnValueOnce(qb(orgPlan))
        .mockReturnValueOnce(qb(adminMembership))
        .mockReturnValueOnce(profiles);
      const result = await service.handleWebhook(orgEvent, 'manager');
      expect(result.success).toBe(true);
      expect(admin.rpc).toHaveBeenCalledWith('apply_org_plan', {
        p_org_id: 'org-1',
        p_plan: 'campus',
      });
      expect(profiles.update).toHaveBeenCalledWith({ personal_plan_key: 'campus' });
    });

    it('does not change anything without an org id', async () => {
      mock.from.mockReturnValueOnce(qb(orgPlan));
      const result = await service.handleWebhook({ ...orgEvent, org_id: undefined }, 'manager');
      expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('does not change an org the caller does not administer', async () => {
      mock.from.mockReturnValueOnce(qb(orgPlan)).mockReturnValueOnce(qb(teacherMembership));
      const result = await service.handleWebhook(orgEvent, 'manager');
      expect(result).toEqual({ success: false, error: 'FORBIDDEN' });
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('does not touch the personal plan when applying the org plan fails', async () => {
      admin.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } });
      mock.from.mockReturnValueOnce(qb(orgPlan)).mockReturnValueOnce(qb(adminMembership));
      const result = await service.handleWebhook(orgEvent, 'manager');
      expect(result.success).toBe(false);
      expect(mock.from).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleWebhook', () => {
    it('ignores events other than checkout.session.completed', async () => {
      const result = await service.handleWebhook({ ...event, type: 'other' }, 'student');
      expect(result.success).toBe(true);
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('updates the personal plan when the plan matches the account type', async () => {
      const profiles = qb(null);
      mock.from.mockReturnValueOnce(qb(studentPlan)).mockReturnValueOnce(profiles);
      const result = await service.handleWebhook(event, 'student');
      expect(result.success).toBe(true);
      expect(profiles.update).toHaveBeenCalledWith({ personal_plan_key: 'spark' });
      expect(profiles.eq).toHaveBeenCalledWith('id', 'u-1');
    });

    it('does not touch the profile for a plan meant for another account type (#192)', async () => {
      mock.from.mockReturnValueOnce(qb(orgPlan));
      const result = await service.handleWebhook({ ...event, plan_id: 'campus' }, 'student');
      expect(result).toEqual({ success: false, error: 'FORBIDDEN' });
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('does not touch the profile for an unknown plan', async () => {
      mock.from.mockReturnValueOnce(qb(null));
      const result = await service.handleWebhook({ ...event, plan_id: 'nope' }, 'student');
      expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
      expect(mock.from).toHaveBeenCalledTimes(1);
    });
  });
});
