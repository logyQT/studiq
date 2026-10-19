import { createClient } from '@admin/lib/supabase/admin-client';
import type { CreateUserInput, ListUsersQuery } from '@admin/server/models/user-admin.model';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, success } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';

// Accounts are banned for this long once soft-deleted, so they can't sign
// in during the grace window without needing our own session check.
const BAN_DURATION = '876000h'; // ~100 years
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

function sanitizeSearchTerm(term: string): string {
  // Stripped, not escaped: these characters have syntactic meaning in a
  // PostgREST .or() filter string, and the search box doesn't need to
  // support matching them literally.
  return term.replace(/[,()]/g, '');
}

export class UserAdminService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  /** Hard-deletes any account whose grace period has elapsed. Called at the
   * top of listUsers() (no cron infra in this repo yet) and exposed via its
   * own route for a future real scheduler. */
  async purgeExpired(): Promise<void> {
    const supabase = await this.createClient();
    const { data: expired } = await supabase
      .from('profiles')
      .select('id')
      .not('purge_at', 'is', null)
      .lt('purge_at', new Date().toISOString());

    for (const row of expired ?? []) {
      await supabase.auth.admin.deleteUser(row.id);
    }
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

  async listUsers(query: ListUsersQuery) {
    await this.purgeExpired();

    const supabase = await this.createClient();
    const offset = (query.page - 1) * query.perPage;

    let dbQuery = supabase
      .from('profiles')
      .select('id, email, full_name, created_at, personal_plan_key, deleted_at, purge_at', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range(offset, offset + query.perPage - 1);

    dbQuery =
      query.status === 'deleted'
        ? dbQuery.not('deleted_at', 'is', null)
        : dbQuery.is('deleted_at', null);

    if (query.search) {
      const term = sanitizeSearchTerm(query.search);
      dbQuery = dbQuery.or(`email.ilike.%${term}%,full_name.ilike.%${term}%`);
    }

    const { data: profiles, error, count } = await dbQuery;
    if (error) return toDbFailure(error);

    const users = await this.enrich((profiles ?? []) as ProfileRow[], supabase);

    return success({ users, total: count ?? 0, page: query.page, perPage: query.perPage });
  }

  async getUser(id: string) {
    const supabase = await this.createClient();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, created_at, personal_plan_key, deleted_at, purge_at')
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

    if (error) return failure(error.code === 'email_exists' ? 'CONFLICT' : 'INTERNAL_SERVER');
    return success(data.user);
  }

  async updateAccountType(id: string, accountType: string) {
    const supabase = await this.createClient();
    const { data: current, error: fetchError } = await supabase.auth.admin.getUserById(id);
    if (fetchError || !current.user) return failure('NOT_FOUND');

    const { data, error } = await supabase.auth.admin.updateUserById(id, {
      app_metadata: { ...current.user.app_metadata, account_type: accountType },
    });

    if (error) return failure('INTERNAL_SERVER');
    return success(data.user);
  }

  async softDeleteUser(id: string) {
    const supabase = await this.createClient();

    const { error: banError } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: BAN_DURATION,
    });
    if (banError) return failure('INTERNAL_SERVER');

    const now = new Date();
    const purgeAt = new Date(now.getTime() + GRACE_PERIOD_MS);

    const { error } = await supabase
      .from('profiles')
      .update({ deleted_at: now.toISOString(), purge_at: purgeAt.toISOString() })
      .eq('id', id);

    if (error) return toDbFailure(error);
    return success({ purgeAt: purgeAt.toISOString() });
  }

  async restoreUser(id: string) {
    const supabase = await this.createClient();

    const { error: unbanError } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: 'none',
    });
    if (unbanError) return failure('INTERNAL_SERVER');

    const { error } = await supabase
      .from('profiles')
      .update({ deleted_at: null, purge_at: null })
      .eq('id', id);

    if (error) return toDbFailure(error);
    return success({ success: true });
  }

  /** Bypasses the grace period. Only meaningful for an already
   * soft-deleted account -- the "usuń trwale teraz" action in the trash
   * view, not a shortcut around soft-delete for active accounts. */
  async purgeNow(id: string) {
    const supabase = await this.createClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (!profile?.deleted_at) return failure('BAD_REQUEST');

    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) return failure('INTERNAL_SERVER');
    return success({ success: true });
  }
}

export const userAdminService = wrapService(
  new UserAdminService(createClient),
  'user-admin.service',
);
