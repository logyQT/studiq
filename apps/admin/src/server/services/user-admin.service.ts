import { createClient } from '@admin/lib/supabase/admin-client';
import type { CreateUserInput, ListUsersQuery } from '@admin/server/models/user-admin.model';
import { error as logError, warn } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';

// Accounts are banned for this long once soft-deleted, so they can't sign
// in during the grace window without needing our own session check.
const BAN_DURATION = '876000h'; // ~100 years
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// purgeExpired() runs on every admin list load (there is no cron yet), so it
// works in bounded batches instead of stalling the request on a large backlog.
const PURGE_BATCH_SIZE = 100;

const PROFILE_COLUMNS = 'id, email, full_name, created_at, personal_plan_key, deleted_at, purge_at';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: string;
  personalPlanKey: string | null;
  accountType: string | null;
  bannedUntil: string | null;
  deletedAt: string | null;
  purgeAt: string | null;
}

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  personal_plan_key: string | null;
  deleted_at: string | null;
  purge_at: string | null;
}

export interface PurgeExpiredResult {
  purged: number;
  failed: number;
}

/** Neutralises the characters that are syntactic in a PostgREST `.or()` /
 * `ilike` filter: `,()` delimit the or-expression and `%_\\` are ILIKE
 * wildcards/escapes, so a search term can't widen the filter it lands in. */
function sanitizeSearchTerm(term: string): string {
  return term
    .replace(/[,()]/g, '')
    .replace(/[\\%_]/g, (char) => `\\${char}`)
    .trim();
}

export class UserAdminService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  /** Hard-deletes any account whose grace period has elapsed. Called at the
   * top of listUsers() (no cron infra in this repo yet) and exposed via its
   * own route for a future real scheduler. */
  async purgeExpired(): Promise<ServiceResult<PurgeExpiredResult>> {
    const supabase = await this.createClient();
    const { data: expired, error } = await supabase
      .from('profiles')
      .select('id')
      // Both halves are load-bearing: a live account (deleted_at IS NULL) must
      // never be purged even if purge_at was somehow set, which is exactly the
      // escalation that a forged purge_at used to achieve.
      .not('deleted_at', 'is', null)
      .not('purge_at', 'is', null)
      .lt('purge_at', new Date().toISOString())
      .order('purge_at', { ascending: true })
      .limit(PURGE_BATCH_SIZE);

    if (error) {
      logError('user-admin: failed to load purgeable accounts', { error });
      return toDbFailure(error);
    }

    let purged = 0;
    let failed = 0;

    for (const row of expired ?? []) {
      const result = await this.deleteAccount(supabase, row.id);
      if (result.success) purged += 1;
      else failed += 1;
    }

    if (failed > 0) {
      warn('user-admin: some expired accounts could not be purged', { purged, failed });
    }

    return success({ purged, failed });
  }

  /** Deletes the rows that reference `profiles(id)` through NO ACTION foreign
   * keys before handing the account to GoTrue, which would otherwise fail
   * forever with "Database error deleting user" for anyone holding a seat.
   *
   * - `org_seat_assignments.user_id` -> profiles(id) is NO ACTION; deleting the
   *   row also makes `maintain_seat_counts` return the seat to its pool.
   * - `user_feature_overrides.created_by` -> profiles(id) is NO ACTION, so rows
   *   this account granted to other users have to go too (rows granted *to*
   *   the account are ON DELETE CASCADE and disappear with the profile).
   */
  private async deleteAccount(
    supabase: SupabaseClient,
    id: string,
  ): Promise<ServiceResult<{ success: true }>> {
    const { error: seatError } = await supabase
      .from('org_seat_assignments')
      .delete()
      .eq('user_id', id);
    if (seatError) {
      logError('user-admin: failed to release seat assignments before delete', {
        userId: id,
        error: seatError,
      });
      return toDbFailure(seatError);
    }

    const { error: overrideError } = await supabase
      .from('user_feature_overrides')
      .delete()
      .eq('created_by', id);
    if (overrideError) {
      logError('user-admin: failed to clear granted feature overrides before delete', {
        userId: id,
        error: overrideError,
      });
      return toDbFailure(overrideError);
    }

    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) {
      logError('user-admin: auth.admin.deleteUser failed', { userId: id, error });
      return failure('INTERNAL_SERVER');
    }

    return success({ success: true });
  }

  private async enrich(profiles: ProfileRow[], supabase: SupabaseClient): Promise<AdminUser[]> {
    return Promise.all(
      profiles.map(async (p) => {
        const { data } = await supabase.auth.admin.getUserById(p.id);
        return {
          id: p.id,
          email: p.email,
          fullName: p.full_name,
          createdAt: p.created_at,
          personalPlanKey: p.personal_plan_key,
          deletedAt: p.deleted_at,
          purgeAt: p.purge_at,
          accountType: (data.user?.app_metadata?.account_type as string) ?? null,
          bannedUntil: data.user?.banned_until ?? null,
        };
      }),
    );
  }

  /** Applies the list filters shared by the paged query and the count-only
   * fallback, so the two can never disagree about what "total" means. */
  private applyListFilters(dbQuery: any, query: ListUsersQuery): any {
    let filtered =
      query.status === 'deleted'
        ? dbQuery.not('deleted_at', 'is', null)
        : dbQuery.is('deleted_at', null);

    if (query.search) {
      const term = sanitizeSearchTerm(query.search);
      // A term made only of filter syntax sanitises to nothing; dropping the
      // filter (rather than emitting `%%`) keeps it from matching everything.
      if (term) {
        filtered = filtered.or(`email.ilike.%${term}%,full_name.ilike.%${term}%`);
      }
    }

    return filtered;
  }

  private async countUsers(
    supabase: SupabaseClient,
    query: ListUsersQuery,
  ): Promise<ServiceResult<number>> {
    const dbQuery = this.applyListFilters(
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      query,
    );

    const { count, error } = await dbQuery;
    if (error) return toDbFailure(error);
    return success(count ?? 0);
  }

  async listUsers(query: ListUsersQuery) {
    await this.purgeExpired();

    const supabase = await this.createClient();
    const offset = (query.page - 1) * query.perPage;

    const pagedQuery = this.applyListFilters(
      supabase
        .from('profiles')
        .select(PROFILE_COLUMNS, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + query.perPage - 1),
      query,
    );

    const { data: profiles, error, count } = await pagedQuery;
    if (error) {
      // PostgREST answers 416/PGRST103 ("offset N requested, only M rows") for
      // a page past the end -- which the admin UI legitimately reaches after
      // deleting the last row of a page. It is an empty page, not a failure.
      if (error.code === 'PGRST103') {
        const total = await this.countUsers(supabase, query);
        if (!total.success) return total;
        return success({ users: [], total: total.data, page: query.page, perPage: query.perPage });
      }
      return toDbFailure(error);
    }

    const users = await this.enrich((profiles ?? []) as ProfileRow[], supabase);

    return success({ users, total: count ?? 0, page: query.page, perPage: query.perPage });
  }

  async getUser(id: string) {
    const supabase = await this.createClient();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!profile) return failure('NOT_FOUND');

    const [user] = await this.enrich([profile as ProfileRow], supabase);

    const { data: memberships } = await supabase
      .from('org_members')
      .select('organization_id, organizations!inner(name), org_roles!inner(name)')
      .eq('user_id', id);

    return success({ ...user, memberships: memberships ?? [] });
  }

  async createUser(input: CreateUserInput) {
    const supabase = await this.createClient();
    // handle_new_user() validates account_type on INSERT. app_metadata
    // passed here isn't visible to the trigger in time (GoTrue applies it
    // in a separate step after the row exists), so account_type has to go
    // through user_metadata -- the trigger's own documented fallback path
    // for "client-supplied" values. It re-normalizes into app_metadata
    // itself once the row is validated.
    const { data, error } = await supabase.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        account_type: input.accountType,
        ...(input.fullName ? { name: input.fullName } : {}),
      },
    });

    if (error) {
      if (error.code === 'email_exists') return failure('CONFLICT');
      if (error.code === 'weak_password' || error.code === 'validation_failed') {
        return failure('UNPROCESSABLE_ENTITY');
      }
      logError('user-admin: auth.admin.createUser failed', { error });
      return failure('INTERNAL_SERVER');
    }

    return success(data.user);
  }

  async updateAccountType(id: string, accountType: string) {
    const supabase = await this.createClient();
    const { data: current, error: fetchError } = await supabase.auth.admin.getUserById(id);

    if (fetchError) {
      // GoTrue answers 404/user_not_found for an unknown id; anything else is
      // a backend failure and must not be reported as "user does not exist".
      if (fetchError.status === 404 || fetchError.code === 'user_not_found') {
        return failure('NOT_FOUND');
      }
      logError('user-admin: auth.admin.getUserById failed', { userId: id, error: fetchError });
      return failure('INTERNAL_SERVER');
    }
    if (!current.user) return failure('NOT_FOUND');

    const { data, error } = await supabase.auth.admin.updateUserById(id, {
      app_metadata: { ...current.user.app_metadata, account_type: accountType },
    });

    if (error) {
      logError('user-admin: auth.admin.updateUserById failed', { userId: id, error });
      return failure('INTERNAL_SERVER');
    }
    return success(data.user);
  }

  async softDeleteUser(id: string) {
    const supabase = await this.createClient();

    const { data: profile, error: readError } = await supabase
      .from('profiles')
      .select('deleted_at, purge_at')
      .eq('id', id)
      .maybeSingle();

    if (readError) return toDbFailure(readError);
    if (!profile) return failure('NOT_FOUND');

    // Idempotent: deleting an already soft-deleted account keeps its original
    // purge_at so a repeat click can't extend the grace window by 30 days.
    const deletedAt = profile.deleted_at ?? new Date().toISOString();
    const purgeAt =
      profile.purge_at ?? new Date(new Date(deletedAt).getTime() + GRACE_PERIOD_MS).toISOString();

    // Ban first, then persist the markers: a failed DB write leaves a locked
    // account an operator can see and retry (the operation is idempotent),
    // whereas a purge-queued account that never got banned would stay usable
    // during the whole grace window. A retry of DELETE /users/{id} completes
    // the half-applied state.
    const { error: banError } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: BAN_DURATION,
    });
    if (banError) {
      logError('user-admin: auth.admin.updateUserById (ban) failed', {
        userId: id,
        error: banError,
      });
      return failure('INTERNAL_SERVER');
    }

    const { data: updated, error } = await supabase
      .from('profiles')
      .update({ deleted_at: deletedAt, purge_at: purgeAt })
      .eq('id', id)
      .select('id');

    if (error) return toDbFailure(error);
    if (!updated?.length) return failure('NOT_FOUND');
    return success({ purgeAt });
  }

  async restoreUser(id: string) {
    const supabase = await this.createClient();

    const { data: profile, error: readError } = await supabase
      .from('profiles')
      .select('deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (readError) return toDbFailure(readError);
    if (!profile) return failure('NOT_FOUND');
    // Only accounts the admin delete flow soft-deleted can be restored: an
    // account banned for moderation has no deleted_at and must stay banned.
    if (!profile.deleted_at) return failure('BAD_REQUEST');

    // Clear the purge markers BEFORE unbanning. A failure here leaves the
    // account banned (recoverable, visible); the reverse order could leave an
    // unbanned account that is still queued for hard deletion.
    const { data: updated, error } = await supabase
      .from('profiles')
      .update({ deleted_at: null, purge_at: null })
      .eq('id', id)
      .select('id');

    if (error) return toDbFailure(error);
    if (!updated?.length) return failure('NOT_FOUND');

    const { error: unbanError } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: 'none',
    });
    if (unbanError) {
      logError('user-admin: auth.admin.updateUserById (unban) failed', {
        userId: id,
        error: unbanError,
      });
      return failure('INTERNAL_SERVER');
    }

    return success({ success: true });
  }

  /** Bypasses the grace period. Only meaningful for an already
   * soft-deleted account -- the "usuń trwale teraz" action in the trash
   * view, not a shortcut around soft-delete for active accounts. */
  async purgeNow(id: string) {
    const supabase = await this.createClient();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!profile) return failure('NOT_FOUND');
    if (!profile.deleted_at) return failure('BAD_REQUEST');

    return this.deleteAccount(supabase, id);
  }
}

export const userAdminService = wrapService(
  new UserAdminService(createClient),
  'user-admin.service',
);
