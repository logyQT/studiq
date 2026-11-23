import { AccountType, type PermissionScope, type RequestContext } from '@studiq/authz';
import { PermissionsController } from '@studiq/server/controllers/permissions.controller';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What `listMyPermissions` puts in the response's `data`. */
interface PermissionsBody {
  orgId: string | null;
  permissions: Record<string, PermissionScope>;
  entitlements?: Record<string, boolean>;
}

/** The payload is declared `unknown`; this guard narrows it to what the endpoint promises. */
function isPermissionsBody(value: unknown): value is PermissionsBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'permissions' in value &&
    typeof value.permissions === 'object' &&
    value.permissions !== null
  );
}

/** The controller's declared response is `ControllerResponse<unknown>`; this narrows `data`. */
function body(response: ControllerResponse): PermissionsBody {
  if (!response.success || !isPermissionsBody(response.data)) {
    throw new Error('expected the resolved permissions payload');
  }
  return response.data;
}

const mockCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.STUDENT,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: { 'flashcard.read': 'own' },
};

describe('PermissionsController', () => {
  let controller: PermissionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PermissionsController();
  });

  describe('listMyPermissions', () => {
    it('returns the resolved permissions map', async () => {
      const response = await controller.listMyPermissions(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(body(response).permissions).toBeDefined();
    });

    it('returns only the permissions map (entitlements live on /me/entitlements)', async () => {
      const response = await controller.listMyPermissions(mockCtx);

      expect(body(response).entitlements).toBeUndefined();
    });

    // The client keys its cache by the org the map belongs to, so the payload
    // must name it instead of leaving the caller to assume the active org.
    it('echoes the active org id the map was resolved for', async () => {
      const inOrgCtx: RequestContext = {
        ...mockCtx,
        activeOrgId: 'org-9',
        orgRoleId: 'role-9',
        permissionScopes: { 'deck.read': 'organization' },
      };

      expect(body(await controller.listMyPermissions(inOrgCtx)).orgId).toBe('org-9');
      expect(body(await controller.listMyPermissions(mockCtx)).orgId).toBeNull();
    });

    it('adds default own permissions for student', async () => {
      const response = await controller.listMyPermissions(mockCtx);

      expect(response.success).toBe(true);
      const perms = body(response).permissions;
      expect(perms['flashcard.read']).toBe('own');
      // Resolved by `resolveScope` (no org, content key), not carried in ctx.permissionScopes.
      expect(perms['deck.delete']).toBe('own');
      // Only CRUD verbs get the default: `assignment.publish` is a real Permission
      // without a CRUD suffix, so a filter widened to "every permission" would add it.
      expect(perms['assignment.publish']).toBeUndefined();
      expect(perms['assignment.grade']).toBeUndefined();
    });

    // The category guard at the payload boundary: a content CRUD key takes the
    // persona default, a `group.*`/`org.*` key never does, and the two are
    // asserted together so a payload that emitted `own` for everything is red.
    it('gives the persona default to content keys only, never group or org keys', async () => {
      const response = await controller.listMyPermissions(mockCtx);

      const perms = body(response).permissions;
      expect(perms['deck.update']).toBe('own');
      expect(perms['group.read']).toBeUndefined();
      expect(perms['org.audit.read']).toBeUndefined();
      expect(perms['org.role.manage']).toBeUndefined();
    });

    it('adds own permissions for educator', async () => {
      const educatorCtx = { ...mockCtx, accountType: AccountType.EDUCATOR };
      const response = await controller.listMyPermissions(educatorCtx);

      expect(response.success).toBe(true);
      expect(body(response).permissions['question_bank.update']).toBe('own');
    });

    // ADR-0015 §6.3: the payload is what `usePermission()` gates the UI on, so it
    // must stop claiming a scope the API would deny — the same fail-closed rule.
    it('claims no content key inside an org whose role has no row for it', async () => {
      const inOrgCtx: RequestContext = {
        ...mockCtx,
        activeOrgId: 'org-1',
        orgRoleId: 'role-1',
        permissionScopes: { 'deck.read': 'group' },
      };

      const perms = body(await controller.listMyPermissions(inOrgCtx)).permissions;

      expect(perms['deck.read']).toBe('group');
      expect(perms['flashcard.read']).toBeUndefined();
      expect(perms['deck.delete']).toBeUndefined();
    });

    it('claims nothing for a manager with no org and no role row', async () => {
      const managerCtx = { ...mockCtx, accountType: AccountType.MANAGER, permissionScopes: {} };

      const perms = body(await controller.listMyPermissions(managerCtx)).permissions;

      expect(perms).toEqual({});
    });
  });
});
