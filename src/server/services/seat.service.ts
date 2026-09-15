import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type { CreateAssignmentInput, CreatePoolInput, UpdatePoolInput } from '@/server/models';

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
