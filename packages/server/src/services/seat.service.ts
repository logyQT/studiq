import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateAssignmentInput,
  CreatePoolInput,
  UpdatePoolInput,
} from '@studiq/server/models/seat.model';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Maps plan_key → compatible account tier. Used for role-aware seat
 * assignment: a teacher (educator tier) should only get educator-tier seats,
 * a student (student tier) should only get student-tier seats, etc.
 */
const PLAN_TIER_MAP: Record<string, string> = {
  base: 'student',
  spark: 'student',
  ace: 'student',
  pro: 'student',
  lite: 'educator',
  guide: 'educator',
  creator: 'educator',
  master: 'educator',
  launch: 'manager',
  team: 'manager',
  hub: 'manager',
  campus: 'manager',
};

/**
 * Maps org role name → compatible account tier.
 */
const ROLE_TIER_MAP: Record<string, string> = {
  admin: 'manager',
  teacher: 'educator',
  member: 'student',
};

export class SeatService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async listPools(
    ctx: RequestContext,
  ): Promise<ServiceResult<{ id: string; planKey: string; total: number; assigned: number }[]>> {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('org_seat_pools')
      .select('id, plan_key, total, assigned')
      .eq('organization_id', ctx.activeOrgId)
      .order('plan_key');

    if (error) return toDbFailure(error);

    return success(
      (data ?? []).map((p) => ({
        id: p.id,
        planKey: p.plan_key,
        total: p.total,
        assigned: p.assigned,
      })),
    );
  }

  async addPool(
    ctx: RequestContext,
    input: CreatePoolInput,
  ): Promise<ServiceResult<{ id: string; planKey: string; total: number; assigned: number }>> {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.createClient();

    // Upsert: if a pool for this plan already exists, increment its total.
    const { data: existing } = await supabase
      .from('org_seat_pools')
      .select('id, total')
      .eq('organization_id', ctx.activeOrgId)
      .eq('plan_key', input.planKey)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from('org_seat_pools')
        .update({ total: existing.total + input.quantity })
        .eq('id', existing.id)
        .select('id, plan_key, total, assigned')
        .maybeSingle();

      if (error) return toDbFailure(error);
      if (!data) return failure('INTERNAL_SERVER');

      return success({
        id: data.id,
        planKey: data.plan_key,
        total: data.total,
        assigned: data.assigned,
      });
    }

    const { data, error } = await supabase
      .from('org_seat_pools')
      .insert({
        organization_id: ctx.activeOrgId,
        plan_key: input.planKey,
        total: input.quantity,
      })
      .select('id, plan_key, total, assigned')
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return failure('INTERNAL_SERVER');

    return success({
      id: data.id,
      planKey: data.plan_key,
      total: data.total,
      assigned: data.assigned,
    });
  }

  async updatePool(
    ctx: RequestContext,
    poolId: string,
    input: UpdatePoolInput,
  ): Promise<ServiceResult<{ id: string; planKey: string; total: number; assigned: number }>> {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('org_seat_pools')
      .update({ total: input.total })
      .eq('id', poolId)
      .eq('organization_id', ctx.activeOrgId)
      .select('id, plan_key, total, assigned')
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return failure('NOT_FOUND');

    return success({
      id: data.id,
      planKey: data.plan_key,
      total: data.total,
      assigned: data.assigned,
    });
  }

  async listAssignments(ctx: RequestContext): Promise<
    ServiceResult<
      {
        id: string;
        userId: string;
        poolId: string;
        planKey: string;
        userEmail: string;
        userFullName: string | null;
        assignedAt: string;
      }[]
    >
  > {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('org_seat_assignments')
      .select(
        `
        id, user_id, pool_id, assigned_at,
        pool:org_seat_pools!inner(plan_key),
        profile:profiles!inner(email, full_name)
      `,
      )
      .eq('organization_id', ctx.activeOrgId)
      .order('assigned_at', { ascending: false });

    if (error) return toDbFailure(error);

    return success(
      (data ?? []).map((a) => ({
        id: a.id,
        userId: a.user_id,
        poolId: a.pool_id,
        planKey: (a.pool as unknown as { plan_key: string }).plan_key,
        userEmail: (a.profile as unknown as { email: string }).email,
        userFullName: (a.profile as unknown as { full_name: string | null }).full_name,
        assignedAt: a.assigned_at,
      })),
    );
  }

  async assignSeat(
    ctx: RequestContext,
    input: CreateAssignmentInput,
  ): Promise<
    ServiceResult<{
      id: string;
      userId: string;
      poolId: string;
      planKey: string;
      userEmail: string;
      assignedAt: string;
    }>
  > {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.createClient();

    // Verify pool belongs to active org
    const { data: pool, error: poolErr } = await supabase
      .from('org_seat_pools')
      .select('id, plan_key')
      .eq('id', input.poolId)
      .eq('organization_id', ctx.activeOrgId)
      .maybeSingle();

    if (poolErr) return toDbFailure(poolErr);
    if (!pool) return failure('NOT_FOUND');

    // Verify user exists
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', input.userId)
      .maybeSingle();

    if (profileErr) return toDbFailure(profileErr);
    if (!profile) return failure('NOT_FOUND');

    // Role-aware validation: pool plan tier must match target user's org role tier
    const poolTier = PLAN_TIER_MAP[pool.plan_key];
    if (poolTier) {
      const { data: member } = await supabase
        .from('org_members')
        .select('org_roles!inner(name)')
        .eq('organization_id', ctx.activeOrgId)
        .eq('user_id', input.userId)
        .maybeSingle();

      const roleName = (member?.org_roles as unknown as { name: string })?.name;
      const userTier = roleName ? ROLE_TIER_MAP[roleName] : undefined;

      if (userTier && userTier !== poolTier) {
        return failure('BAD_REQUEST');
      }
    }

    // Check if user already has a seat in this org (will be caught by unique constraint, but let's be explicit)
    const { data: existing } = await supabase
      .from('org_seat_assignments')
      .select('id')
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', input.userId)
      .maybeSingle();

    if (existing) {
      return failure('USAGE_LIMIT_EXCEEDED');
    }

    // Insert assignment (trigger checks pool capacity + increments assigned count)
    const { data, error } = await supabase
      .from('org_seat_assignments')
      .insert({
        organization_id: ctx.activeOrgId,
        pool_id: input.poolId,
        user_id: input.userId,
      })
      .select('id, user_id, pool_id, assigned_at')
      .maybeSingle();

    if (error) {
      // Check for SEAT_POOL_FULL from trigger
      if (error.message?.includes('SEAT_POOL_FULL') || error.code === '23514') {
        return failure('USAGE_LIMIT_EXCEEDED');
      }
      return toDbFailure(error);
    }

    if (!data) return failure('INTERNAL_SERVER');

    return success({
      id: data.id,
      userId: data.user_id,
      poolId: data.pool_id,
      planKey: pool.plan_key,
      userEmail: profile.email,
      assignedAt: data.assigned_at,
    });
  }

  async unassignSeat(ctx: RequestContext, assignmentId: string): Promise<ServiceResult<void>> {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.createClient();

    const { error } = await supabase
      .from('org_seat_assignments')
      .delete()
      .eq('id', assignmentId)
      .eq('organization_id', ctx.activeOrgId);

    if (error) return toDbFailure(error);

    return success(undefined);
  }
}
export const seatService = wrapService(new SeatService(createClient), 'seat.service');
