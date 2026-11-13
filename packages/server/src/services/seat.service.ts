import type { RequestContext } from '@studiq/authz';
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

/**
 * A to-one embed (`org_roles!inner(name)`) is typed as an object, but the wire
 * can deliver a one-element array for it (the guard `stripe-repository.ts` uses
 * for the same relation on `org_members`). Read both shapes, because
 * `undefined` here would skip the tier check (#1068).
 */
function embeddedRoleName(value: { name: string } | { name: string }[]): string | null {
  const related = Array.isArray(value) ? value[0] : value;
  return related?.name ?? null;
}

/** `total` below `assigned` would leave assignments that no longer fit the pool. */
function totalTooSmallDetails(): ZodIssue[] {
  return [{ code: 'custom', message: ValidationErrorCode.TOO_SMALL, path: ['total'] }];
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

  async addPool(
    ctx: RequestContext,
    input: CreatePoolInput,
  ): Promise<ServiceResult<{ id: string; planKey: string; total: number; assigned: number }>> {
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.clientFactory();

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
      // this write; keep the response a 422 field error rather than an opaque
      // constraint violation.
      if (error.code === '23514') {
        return failure('UNPROCESSABLE_ENTITY', totalTooSmallDetails());
      }
      return toDbFailure(error);
    }
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

    // Verify pool belongs to active org
    const { data: pool, error: poolErr } = await supabase
      .from('org_seat_pools')
      .select('id, plan_key')
      .eq('id', input.poolId)
      .eq('organization_id', ctx.activeOrgId)
      .maybeSingle();

    if (poolErr) return toDbFailure(poolErr);
    if (!pool) return failure('NOT_FOUND');

    // Role-aware validation: the pool's plan tier must match the member's org
    // role tier. Every unresolvable input refuses instead of skipping the check:
    // skipping is what let a student-tier seat reach a teacher (#1068). A plan
    // or role without a tier has to be added to the maps above to be assignable.
    const poolTier = PLAN_TIER_MAP[pool.plan_key];
    if (!poolTier) return failure('BAD_REQUEST');

    // Verify user exists
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', input.userId)
      .maybeSingle();

    if (profileErr) return toDbFailure(profileErr);
    if (!profile) return failure('NOT_FOUND');

    const { data: member, error: memberErr } = await supabase
      .from('org_members')
      .select('org_roles!inner(name)')
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', input.userId)
      .maybeSingle();

    if (memberErr) return toDbFailure(memberErr);

    // A target without an org membership holds no org role, so there is no tier
    // to contradict; the seat grants nothing until they join (org features
    // resolve through membership). Anything else resolves to a tier or refuses:
    // an unmapped role, like an unmapped plan, is a refusal because skipping it
    // is what let a student-tier seat reach a teacher (#1068).
    if (member) {
      const roleName = embeddedRoleName(member.org_roles);
      const userTier = roleName ? ROLE_TIER_MAP[roleName] : undefined;
      if (userTier !== poolTier) return failure('BAD_REQUEST');
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
