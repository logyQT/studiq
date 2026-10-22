import { UserAdminService } from '@admin/server/services/user-admin.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

const DAY_MS = 24 * 60 * 60 * 1000;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

interface QbResult {
  data?: unknown;
  error?: { code?: string; message?: string; status?: number } | null;
  count?: number | null;
}

/**
 * Chainable PostgREST builder stand-in. Every method returns the builder and
 * awaiting the builder resolves `{ data, error, count }`, so both
 * `.select().maybeSingle()` and `await .update().eq().select('id')` work.
 */
function qb(result: QbResult = {}) {
  const resolved = {
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  };

  const builder: any = {};
  for (const method of [
    'select',
    'order',
    'range',
    'not',
    'is',
    'lt',
    'limit',
    'eq',
    'or',
    'update',
    'delete',
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => ({ data: resolved.data, error: resolved.error }));

  const promise = Promise.resolve(resolved);
  builder.then = promise.then.bind(promise);
  builder.catch = promise.catch.bind(promise);
  builder.finally = promise.finally.bind(promise);

  return builder;
}

function createMockClient() {
  const client = mockSupabaseClient();
  const admin = {
    deleteUser: vi.fn(),
    getUserById: vi.fn(),
    updateUserById: vi.fn(),
    createUser: vi.fn(),
  };

  return {
    client: Object.assign(client, { auth: { ...client.auth, admin } }),
    admin,
  };
}

let mock: ReturnType<typeof createMockClient>['client'];
let adminMock: ReturnType<typeof createMockClient>['admin'];
let service: UserAdminService;

describe('UserAdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The logger falls back to console when the OTel pipeline is off (it is
    // in unit tests); keep expected failure-path logging out of the output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const created = createMockClient();
    mock = created.client;
    adminMock = created.admin;

    adminMock.deleteUser.mockResolvedValue({ data: {}, error: null });
    adminMock.getUserById.mockResolvedValue({ data: { user: null }, error: null });
    adminMock.updateUserById.mockResolvedValue({ data: { user: {} }, error: null });
    adminMock.createUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mock.from.mockReturnValue(qb({ data: [] }));

    service = new UserAdminService(async () => mock as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('purgeExpired', () => {
    it('only selects soft-deleted rows past their purge date, in a bounded batch', async () => {
      const profiles = qb({ data: [{ id: USER_ID }] });
      mock.from.mockReturnValueOnce(profiles);

      const result = await service.purgeExpired();

      expect(result).toEqual({ success: true, data: { purged: 1, failed: 0 } });
      expect(profiles.not).toHaveBeenCalledWith('deleted_at', 'is', null);
      expect(profiles.not).toHaveBeenCalledWith('purge_at', 'is', null);
      expect(profiles.lt).toHaveBeenCalledWith('purge_at', expect.any(String));
      expect(profiles.limit).toHaveBeenCalledWith(100);
    });

    it('releases seat assignments and clears NO ACTION references before deleting the auth user', async () => {
      const events: string[] = [];
      const profiles = qb({ data: [{ id: USER_ID }] });
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return profiles;
        const builder = qb({ data: [] });
        builder.delete.mockImplementation(() => {
          events.push(`delete:${table}`);
          return builder;
        });
        builder.update.mockImplementation(() => {
          events.push(`update:${table}`);
          return builder;
        });
        return builder;
      });
      adminMock.deleteUser.mockImplementation(async () => {
        events.push('deleteUser');
        return { data: {}, error: null };
      });

      await service.purgeExpired();

      expect(events).toEqual([
        'delete:org_seat_assignments',
        'delete:user_feature_overrides',
        'deleteUser',
      ]);
      expect(adminMock.deleteUser).toHaveBeenCalledWith(USER_ID);
    });

    it('counts failures instead of throwing when deleteUser fails', async () => {
      mock.from.mockReturnValueOnce(qb({ data: [{ id: USER_ID }, { id: OTHER_ID }] }));
      adminMock.deleteUser.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({
        data: null,
        error: { code: 'unexpected_failure', message: 'Database error deleting user' },
      });

      const result = await service.purgeExpired();

      expect(result).toEqual({ success: true, data: { purged: 1, failed: 1 } });
      expect(console.error).toHaveBeenCalled();
    });

    it('returns the DB failure and does not attempt deletions when the lookup fails', async () => {
      mock.from.mockReturnValueOnce(qb({ error: { code: '42501', message: 'permission denied' } }));

      const result = await service.purgeExpired();

      expect(result.success).toBe(false);
      expect(adminMock.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('purgeNow', () => {
    it('returns NOT_FOUND when the profile does not exist', async () => {
      mock.from.mockReturnValueOnce(qb({ data: null }));

      const result = await service.purgeNow(USER_ID);

      expect(result).toEqual({ success: false, error: 'NOT_FOUND' });
      expect(adminMock.deleteUser).not.toHaveBeenCalled();
    });

    it('refuses to hard-delete an account that is not soft-deleted', async () => {
      mock.from.mockReturnValueOnce(qb({ data: { deleted_at: null } }));

      const result = await service.purgeNow(USER_ID);

      expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
      expect(adminMock.deleteUser).not.toHaveBeenCalled();
    });

    it('clears seat assignments and granted overrides before deleting the auth user', async () => {
      const events: string[] = [];
      const profile = qb({ data: { deleted_at: '2026-09-01T00:00:00.000Z' } });
      const seats = qb({ data: [] });
      seats.delete.mockImplementation(() => {
        events.push('delete:org_seat_assignments');
        return seats;
      });
      const overrides = qb({ data: [] });
      overrides.delete.mockImplementation(() => {
        events.push('delete:user_feature_overrides');
        return overrides;
      });
      mock.from
        .mockReturnValueOnce(profile)
        .mockReturnValueOnce(seats)
        .mockReturnValueOnce(overrides);
      adminMock.deleteUser.mockImplementation(async () => {
        events.push('deleteUser');
        return { data: {}, error: null };
      });

      const result = await service.purgeNow(USER_ID);

      expect(result).toEqual({ success: true, data: { success: true } });
      expect(events).toEqual([
        'delete:org_seat_assignments',
        'delete:user_feature_overrides',
        'deleteUser',
      ]);
      expect(seats.eq).toHaveBeenCalledWith('user_id', USER_ID);
      expect(overrides.eq).toHaveBeenCalledWith('created_by', USER_ID);
    });

    it('returns INTERNAL_SERVER when auth deletion fails and logs it', async () => {
      mock.from.mockReturnValueOnce(qb({ data: { deleted_at: '2026-09-01T00:00:00.000Z' } }));
      adminMock.deleteUser.mockResolvedValueOnce({
        data: null,
        error: { code: 'unexpected_failure', message: 'Database error deleting user' },
      });

      const result = await service.purgeNow(USER_ID);

      expect(result).toEqual({ success: false, error: 'INTERNAL_SERVER' });
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('softDeleteUser', () => {
    it('keeps the existing purge date when the account is already soft-deleted', async () => {
      mock.from.mockReturnValueOnce(
        qb({
          data: { deleted_at: '2026-09-01T00:00:00.000Z', purge_at: '2026-10-01T00:00:00.000Z' },
        }),
      );
      const update = qb({ data: [{ id: USER_ID }] });
      mock.from.mockReturnValueOnce(update);

      const result = await service.softDeleteUser(USER_ID);

      expect(result).toEqual({ success: true, data: { purgeAt: '2026-10-01T00:00:00.000Z' } });
      expect(update.update).toHaveBeenCalledWith({
        deleted_at: '2026-09-01T00:00:00.000Z',
        purge_at: '2026-10-01T00:00:00.000Z',
      });
      expect(adminMock.updateUserById).toHaveBeenCalledWith(USER_ID, { ban_duration: '876000h' });
    });

    it('sets both markers and bans the account on a fresh soft delete', async () => {
      mock.from.mockReturnValueOnce(qb({ data: { deleted_at: null, purge_at: null } }));
      const update = qb({ data: [{ id: USER_ID }] });
      mock.from.mockReturnValueOnce(update);

      const before = Date.now();
      const result = await service.softDeleteUser(USER_ID);

      expect(result.success).toBe(true);
      if (!result.success) return;
      const purgeAt = new Date(result.data.purgeAt).getTime();
      expect(purgeAt).toBeGreaterThan(before + 29 * DAY_MS);
      expect(purgeAt).toBeLessThan(before + 31 * DAY_MS);
      expect(update.update).toHaveBeenCalledWith({
        deleted_at: expect.any(String),
        purge_at: result.data.purgeAt,
      });
    });

    it('returns NOT_FOUND when the profile does not exist', async () => {
      mock.from.mockReturnValueOnce(qb({ data: null }));

      const result = await service.softDeleteUser(USER_ID);

      expect(result).toEqual({ success: false, error: 'NOT_FOUND' });
      expect(adminMock.updateUserById).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND when the update matches no rows', async () => {
      mock.from.mockReturnValueOnce(qb({ data: { deleted_at: null, purge_at: null } }));
      mock.from.mockReturnValueOnce(qb({ data: [] }));

      const result = await service.softDeleteUser(USER_ID);

      expect(result).toEqual({ success: false, error: 'NOT_FOUND' });
    });
  });

  describe('restoreUser', () => {
    it('returns NOT_FOUND when the profile does not exist', async () => {
      mock.from.mockReturnValueOnce(qb({ data: null }));

      const result = await service.restoreUser(USER_ID);

      expect(result).toEqual({ success: false, error: 'NOT_FOUND' });
      expect(adminMock.updateUserById).not.toHaveBeenCalled();
    });

    it('refuses to unban an account that was not soft-deleted', async () => {
      mock.from.mockReturnValueOnce(qb({ data: { deleted_at: null } }));

      const result = await service.restoreUser(USER_ID);

      expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
      expect(adminMock.updateUserById).not.toHaveBeenCalled();
    });

    it('clears the purge markers before unbanning', async () => {
      const events: string[] = [];
      const profile = qb({ data: { deleted_at: '2026-09-01T00:00:00.000Z' } });
      const update = qb({ data: [{ id: USER_ID }] });
      update.update.mockImplementation(() => {
        events.push('profiles:update');
        return update;
      });
      mock.from.mockReturnValueOnce(profile).mockReturnValueOnce(update);
      adminMock.updateUserById.mockImplementation(async () => {
        events.push('auth:unban');
        return { data: { user: {} }, error: null };
      });

      const result = await service.restoreUser(USER_ID);

      expect(result).toEqual({ success: true, data: { success: true } });
      expect(events).toEqual(['profiles:update', 'auth:unban']);
      expect(update.update).toHaveBeenCalledWith({ deleted_at: null, purge_at: null });
      expect(adminMock.updateUserById).toHaveBeenCalledWith(USER_ID, { ban_duration: 'none' });
    });

    it('does not unban when the profile update fails', async () => {
      mock.from.mockReturnValueOnce(qb({ data: { deleted_at: '2026-09-01T00:00:00.000Z' } }));
      mock.from.mockReturnValueOnce(qb({ error: { code: '42501', message: 'permission denied' } }));

      const result = await service.restoreUser(USER_ID);

      expect(result.success).toBe(false);
      expect(adminMock.updateUserById).not.toHaveBeenCalled();
    });
  });

  describe('listUsers', () => {
    it('maps profile rows to the AdminUser shape', async () => {
      mock.from.mockReturnValueOnce(qb({ data: [] })).mockReturnValueOnce(
        qb({
          count: 1,
          data: [
            {
              id: USER_ID,
              email: 'ada@dev.local',
              full_name: 'Ada',
              created_at: '2026-01-01T00:00:00.000Z',
              personal_plan_key: 'pro',
              deleted_at: null,
              purge_at: null,
            },
          ],
        }),
      );
      adminMock.getUserById.mockResolvedValueOnce({
        data: { user: { app_metadata: { account_type: 'student' }, banned_until: null } },
        error: null,
      });

      const result = await service.listUsers({ page: 1, perPage: 20, status: 'active' });

      expect(result).toEqual({
        success: true,
        data: {
          users: [
            {
              id: USER_ID,
              email: 'ada@dev.local',
              fullName: 'Ada',
              createdAt: '2026-01-01T00:00:00.000Z',
              personalPlanKey: 'pro',
              accountType: 'student',
              bannedUntil: null,
              deletedAt: null,
              purgeAt: null,
            },
          ],
          total: 1,
          page: 1,
          perPage: 20,
        },
      });
    });

    it('returns an empty page with the real total when PostgREST rejects the offset', async () => {
      const paged = qb({ error: { code: 'PGRST103', message: 'Requested range not satisfiable' } });
      const counted = qb({ count: 10 });
      mock.from
        .mockReturnValueOnce(qb({ data: [] }))
        .mockReturnValueOnce(paged)
        .mockReturnValueOnce(counted);

      const result = await service.listUsers({ page: 2, perPage: 20, status: 'active' });

      expect(result).toEqual({
        success: true,
        data: { users: [], total: 10, page: 2, perPage: 20 },
      });
      expect(counted.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
      expect(adminMock.getUserById).not.toHaveBeenCalled();
    });

    it('drops the search filter when the term sanitises to nothing', async () => {
      const paged = qb({ data: [], count: 0 });
      mock.from.mockReturnValueOnce(qb({ data: [] })).mockReturnValueOnce(paged);

      await service.listUsers({ page: 1, perPage: 20, status: 'active', search: ',()' });

      expect(paged.or).not.toHaveBeenCalled();
    });

    it('escapes ILIKE wildcards in the search term', async () => {
      const paged = qb({ data: [], count: 0 });
      mock.from.mockReturnValueOnce(qb({ data: [] })).mockReturnValueOnce(paged);

      await service.listUsers({ page: 1, perPage: 20, status: 'active', search: '50%_off' });

      expect(paged.or).toHaveBeenCalledWith(
        'email.ilike.%50\\%\\_off%,full_name.ilike.%50\\%\\_off%',
      );
    });

    it('filters on deleted_at according to the requested status', async () => {
      const paged = qb({ data: [], count: 0 });
      mock.from.mockReturnValueOnce(qb({ data: [] })).mockReturnValueOnce(paged);

      await service.listUsers({ page: 1, perPage: 20, status: 'deleted' });

      expect(paged.not).toHaveBeenCalledWith('deleted_at', 'is', null);
    });
  });

  describe('createUser', () => {
    const input = {
      email: 'new@dev.local',
      password: 'password123',
      accountType: 'student' as const,
    };

    it('returns the created user', async () => {
      const result = await service.createUser(input);

      expect(result).toEqual({ success: true, data: { id: USER_ID } });
      expect(adminMock.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: input.email, email_confirm: true }),
      );
    });

    it('maps email_exists to CONFLICT', async () => {
      adminMock.createUser.mockResolvedValueOnce({
        data: { user: null },
        error: { code: 'email_exists', message: 'User already registered' },
      });

      const result = await service.createUser(input);

      expect(result).toEqual({ success: false, error: 'CONFLICT' });
    });

    it('maps weak_password to UNPROCESSABLE_ENTITY', async () => {
      adminMock.createUser.mockResolvedValueOnce({
        data: { user: null },
        error: { code: 'weak_password', message: 'Password is too weak' },
      });

      const result = await service.createUser(input);

      expect(result).toEqual({ success: false, error: 'UNPROCESSABLE_ENTITY' });
    });

    it('maps unknown failures to INTERNAL_SERVER', async () => {
      adminMock.createUser.mockResolvedValueOnce({
        data: { user: null },
        error: { code: 'unexpected_failure', message: 'boom' },
      });

      const result = await service.createUser(input);

      expect(result).toEqual({ success: false, error: 'INTERNAL_SERVER' });
    });
  });

  describe('updateAccountType', () => {
    it('maps a GoTrue 404 to NOT_FOUND', async () => {
      adminMock.getUserById.mockResolvedValueOnce({
        data: { user: null },
        error: { code: 'user_not_found', status: 404, message: 'User not found' },
      });

      const result = await service.updateAccountType(USER_ID, 'manager');

      expect(result).toEqual({ success: false, error: 'NOT_FOUND' });
      expect(adminMock.updateUserById).not.toHaveBeenCalled();
    });

    it('does not report other GoTrue failures as NOT_FOUND', async () => {
      adminMock.getUserById.mockResolvedValueOnce({
        data: { user: null },
        error: { code: 'unexpected_failure', status: 500, message: 'boom' },
      });

      const result = await service.updateAccountType(USER_ID, 'manager');

      expect(result).toEqual({ success: false, error: 'INTERNAL_SERVER' });
    });

    it('merges the account type into app_metadata', async () => {
      adminMock.getUserById.mockResolvedValueOnce({
        data: { user: { app_metadata: { account_type: 'student', provider: 'email' } } },
        error: null,
      });

      const result = await service.updateAccountType(USER_ID, 'manager');

      expect(result.success).toBe(true);
      expect(adminMock.updateUserById).toHaveBeenCalledWith(USER_ID, {
        app_metadata: { account_type: 'manager', provider: 'email' },
      });
    });
  });
});
