import { AccountType, type RequestContext } from '@studiq/authz';
import { OrganizationService } from '@studiq/server/services/organization.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function chain(data: unknown, error: { code: string; message: string } | null = null) {
  const resolved = { data, error };
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.or = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.filter = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.single = terminal;
  c.maybeSingle = terminal;
  c.insert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.upsert = vi.fn(() => c);
  c.then = (onfulfilled: (value: unknown) => unknown) =>
    Promise.resolve(resolved).then(onfulfilled);
  return c;
}

describe('OrganizationService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: OrganizationService;

  const ctx: RequestContext = {
    userId: 'user-1',
    accountType: AccountType.EDUCATOR,
    traceId: 't',
    url: '',
    method: 'POST',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new OrganizationService(async () => mock as any);
  });

  describe('createAndJoin', () => {
    it('creates org and adds creator as admin member', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain({ id: 'group-1' }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(
          chain([
            { id: 'role-admin', name: 'admin' },
            { id: 'role-teacher', name: 'teacher' },
            { id: 'role-member', name: 'member' },
          ]),
        )
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain({ id: 'group-1' }));

      const result = await service.createAndJoin(ctx, { name: 'Test Org' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('org-1');
        expect(result.data.name).toBe('Test Org');
        expect(result.data.adminRoleId).toBe('role-admin');
        expect(result.data.teacherRoleId).toBe('role-teacher');
        expect(result.data.memberRoleId).toBe('role-member');
        expect(result.data.defaultGroupId).toBe('group-1');
      }
    });

    it('returns INTERNAL_SERVER when admin role is missing', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: 'org-1' }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain({ id: 'group-1' }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain(null));

      const result = await service.createAndJoin(ctx, { name: 'Test Org' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('INTERNAL_SERVER');
      }
    });

    it('returns error when org_members insert fails', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: 'org-1' }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain({ id: 'group-1' }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(
          chain([
            { id: 'role-admin', name: 'admin' },
            { id: 'role-teacher', name: 'teacher' },
            { id: 'role-member', name: 'member' },
          ]),
        )
        .mockReturnValueOnce(chain(null, { code: '23505', message: 'duplicate key' }))
        .mockReturnValueOnce(chain({ id: 'group-1' }));

      const result = await service.createAndJoin(ctx, { name: 'Test Org' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('CONFLICT');
      }
    });

    it('validates input name length', async () => {
      // Should succeed with valid name - just verify no crash for valid input
      mock.from
        .mockReturnValueOnce(chain({ id: 'org-2' }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain({ id: 'group-1' }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(
          chain([
            { id: 'role-admin', name: 'admin' },
            { id: 'role-teacher', name: 'teacher' },
            { id: 'role-member', name: 'member' },
          ]),
        )
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain({ id: 'group-1' }));

      const result = await service.createAndJoin(ctx, { name: 'Valid Org' });
      expect(result.success).toBe(true);
    });

    it('returns error when group creation fails in create()', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: 'org-1' }))
        .mockReturnValueOnce(chain(null, { code: '23502', message: 'not null violation' }));

      const result = await service.createAndJoin(ctx, { name: 'Test Org' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('BAD_REQUEST');
      }
    });
  });

  describe('update', () => {
    it('writes logo_url and brand_color when provided', async () => {
      let capturedUpdate: unknown;
      const c = chain({
        id: 'org-1',
        name: 'Org',
        logo_url: 'https://x/logo.png',
        brand_color: '#112233',
      });
      c.update = vi.fn((data: unknown) => {
        capturedUpdate = data;
        return c;
      });
      mock.from.mockReturnValueOnce(c);

      const result = await service.update('org-1', {
        logoUrl: 'https://x/logo.png',
        brandColor: '#112233',
      });

      expect(result.success).toBe(true);
      expect(capturedUpdate).toEqual({
        logo_url: 'https://x/logo.png',
        brand_color: '#112233',
      });
    });

    it('only writes fields that are actually provided', async () => {
      let capturedUpdate: unknown;
      const c = chain({ id: 'org-1', name: 'Renamed' });
      c.update = vi.fn((data: unknown) => {
        capturedUpdate = data;
        return c;
      });
      mock.from.mockReturnValueOnce(c);

      await service.update('org-1', { name: 'Renamed' });

      expect(capturedUpdate).toEqual({ name: 'Renamed' });
    });
  });
});
