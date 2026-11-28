import { type RequestContext, SALES_CHANNEL_SEAT_POOL } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbNested, dbRows } from '@studiq/server/lib/supabase/rows';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import {
  type CreateAssignmentInput,
  type CreatePoolInput,
  MAX_SEAT_POOL_TOTAL,
  type UpdatePoolInput,
} from '@studiq/server/models/seat.model';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodIssue } from 'zod';
import type { Database } from '../types/database';

/**
 * The table's `total >= assigned` check. PostgREST reports a check violation as
 * `23514` without naming the constraint in a field of its own; the name is in
 * the message, which is the only way to tell this one from the next CHECK added
 * to the table.
 */
const TOTAL_FLOOR_CONSTRAINT = 'org_seat_pools_total_not_below_assigned';

function isTotalFloorViolation(error: { code: string; message: string }): boolean {
  return error.code === '23514' && error.message.includes(TOTAL_FLOOR_CONSTRAINT);
}

/** `total` below `assigned` would leave assignments that no longer fit the pool. */
function totalTooSmallDetails(): ZodIssue[] {
  return [{ code: 'custom', message: ValidationErrorCode.TOO_SMALL, path: ['total'] }];
}

/** One pool's API shape, as every pool read/write returns it. */
type PoolResult = ServiceResult<{ id: string; planKey: string; total: number; assigned: number }>;

/** The API shape of one pool row, shared by every read/write path below. */
function poolResult(data: { id: string; plan_key: string; total: number; assigned: number }) {
  return { id: data.id, planKey: data.plan_key, total: data.total, assigned: data.assigned };
}

export class SeatService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async listPools(
    ctx: RequestContext,
  ): Promise<ServiceResult<{ id: string; planKey: string; total: number; assigned: number }[]>> {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.clientFactory();
    const { data, error } = await supabase
      .from('org_seat_pools')
      .select('id, plan_key, total, assigned')
      .eq('organization_id', ctx.activeOrgId)
      .order('plan_key');

    if (error) return toDbFailure(error);

    return success(
      dbRows(data).map((p) => ({
        id: p.id,
        planKey: p.plan_key,
        total: p.total,
        assigned: p.assigned,
      })),
    );
  }

  async addPool(ctx: RequestContext, input: CreatePoolInput): Promise<PoolResult> {
    // The licence check is catalog truth in one query (D15/D33): the plan must
    // exist, be active, be `scope='personal'`, be sold on the `seat_pool`
    // channel (#1511), and every entitlement key it carries must be
    // `seatEligible` in the live `entitlement_catalog` — a plan with no
    // entitlements is not a licence. Refuse before writing anything, with the
    // same field-error shape as the old tier-map refusal.
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.clientFactory();

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select(
        'key, is_active, scope, sales_channels, plan_entitlements(entitlement_key, entitlement_catalog(seat_eligible))',
      )
      .eq('key', input.planKey)
      .maybeSingle();

    if (planError) return toDbFailure(planError);

    const entitlements = dbRows(plan?.plan_entitlements);
    const isLicence =
      !!plan &&
      !!plan.is_active &&
      plan.scope === 'personal' &&
      plan.sales_channels.includes(SALES_CHANNEL_SEAT_POOL) &&
      entitlements.length > 0 &&
      entitlements.every((row) => !!dbNested(row.entitlement_catalog)?.seat_eligible);
    if (!isLicence) {
      return failure('UNPROCESSABLE_ENTITY', [
        { code: 'custom', message: ValidationErrorCode.INVALID_INPUT, path: ['planKey'] },
      ]);
    }

    // Upsert: if a pool for this plan already exists, increment its total.
    const { data: existing } = await supabase
      .from('org_seat_pools')
      .select('id, total')
      .eq('organization_id', ctx.activeOrgId)
      .eq('plan_key', input.planKey)
      .maybeSingle();

    if (existing) {
      // Each value fits int4 on its own (the schema enforces that), but the sum
      // can still exceed `org_seat_pools.total`'s domain and raise 22003. Reject
      // it as 422 before writing instead of letting it surface as a 500.
      const nextTotal = existing.total + input.quantity;
      if (nextTotal > MAX_SEAT_POOL_TOTAL) {
        return failure('UNPROCESSABLE_ENTITY', [
          { code: 'custom', message: ValidationErrorCode.TOO_BIG, path: ['quantity'] },
        ]);
      }

      const { data, error } = await supabase
        .from('org_seat_pools')
        .update({ total: nextTotal })
        .eq('id', existing.id)
        .select('id, plan_key, total, assigned')
        .maybeSingle();

      if (error) return toDbFailure(error);
      if (!data) return failure('INTERNAL_SERVER');

      return success(poolResult(data));
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

    return success(poolResult(data));
  }

  async updatePool(
    ctx: RequestContext,
    poolId: string,
    input: UpdatePoolInput,
  ): Promise<PoolResult> {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.clientFactory();
    const { data, error } = await supabase
      .from('org_seat_pools')
      .update({ total: input.total })
      .eq('id', poolId)
      .eq('organization_id', ctx.activeOrgId)
      .select('id, plan_key, total, assigned')
      .maybeSingle();

    if (error) {
      // `assigned` is the floor: a smaller `total` orphans seats, drives
      // `total - assigned` negative and leaves the pool permanently full
      // (#1068). The table's check constraint rejects that in the same
      // statement, so a concurrent assignment cannot slip between a read and
      // this write; keep the response a 422 field error rather than the
      // generic 400 an unrelated check violation maps to.
      if (isTotalFloorViolation(error)) {
        return failure('UNPROCESSABLE_ENTITY', totalTooSmallDetails());
      }
      return toDbFailure(error);
    }
    if (!data) return failure('NOT_FOUND');

    return success(poolResult(data));
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
        /** Nullable column (`DEFAULT now()`): an assignment can lack it. */
        assignedAt: string | null;
      }[]
    >
  > {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.clientFactory();
    const { data, error } = await supabase
      .from('org_seat_assignments')
      .select(
        `
        id, user_id, pool_id, assigned_at,
        pool:org_seat_pools!inner(plan_key),
        profile:profiles(email, full_name)
      `,
      )
      .eq('organization_id', ctx.activeOrgId)
      .order('assigned_at', { ascending: false });

    if (error) return toDbFailure(error);

    return success(
      dbRows(data).map((a) => {
        // Left join: `profiles` is RLS-narrowed to the caller's own row and the
        // rows of users who share an organization with them. An assignment that
        // outlived the membership (historical removals) must still be listed so
        // a manager can free the seat, so `profile` may be null here.
        const profile = dbNested(a.profile);
        return {
          id: a.id,
          userId: a.user_id,
          poolId: a.pool_id,
          planKey: a.pool.plan_key,
          userEmail: profile?.email ?? '',
          userFullName: profile?.full_name ?? null,
          assignedAt: a.assigned_at,
        };
      }),
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
      /** Nullable column (`DEFAULT now()`): an assignment can lack it. */
      assignedAt: string | null;
    }>
  > {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.clientFactory();

    // Verify pool belongs to active org.
    const { data: pool, error: poolErr } = await supabase
      .from('org_seat_pools')
      .select('id, plan_key')
      .eq('id', input.poolId)
      .eq('organization_id', ctx.activeOrgId)
      .maybeSingle();

    if (poolErr) return toDbFailure(poolErr);
    if (!pool) return failure('NOT_FOUND');

    // A seat is a per-member licence, independent of role (#1146). The pool is
    // offerable to any member of the organization, and only to a member: the
    // `org_members` row is the membership proof, and the profile embed supplies
    // the email the response returns. A non-member is `NOT_FOUND`, never a
    // write that an unrelated user's seat row would legitimise.
    const { data: member, error: memberErr } = await supabase
      .from('org_members')
      .select('user_id, profiles(email)')
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', input.userId)
      .maybeSingle();

    if (memberErr) return toDbFailure(memberErr);
    const profile = dbNested(member?.profiles);
    if (!member || !profile) return failure('NOT_FOUND');

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
      if (error.message.includes('SEAT_POOL_FULL') || error.code === '23514') {
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

    const supabase = await this.clientFactory();

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
