import { createClient } from '@/lib/supabase/server';
import { withErrorHandling } from '@/lib/with-error-handling';
import { ControllerResponse, controllerResponse } from '@/lib/controller-response';
import { UserRole } from '@/types';

export class PermissionController {
  async getMatrix(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const supabase = await createClient();

      const { data: permissions, error: permError } = await supabase
        .from('permissions')
        .select('id, name')
        .order('name');

      if (permError || !permissions) {
        return controllerResponse.error('INTERNAL_SERVER');
      }

      const { data: rolePerms, error: rpError } = await supabase
        .from('role_permissions')
        .select('role, scope, permission_id');

      if (rpError || !rolePerms) {
        return controllerResponse.error('INTERNAL_SERVER');
      }

      const permNameMap = new Map(permissions.map((p) => [p.id, p.name]));

      const actions = ['create', 'read', 'update', 'delete'] as const;
      const resources = ['flashcard', 'topic', 'deck'] as const;
      const roles: string[] = Object.values(UserRole);

      const matrix: Record<string, Record<string, Record<string, string>>> = {};

      for (const role of roles) {
        matrix[role] = {};
        for (const resource of resources) {
          matrix[role][resource] = {};
          for (const action of actions) {
            const permName = `${resource}.${action}`;
            const matchingRp = rolePerms.find((rp) => {
              const name = permNameMap.get(rp.permission_id);
              return rp.role === role && name === permName;
            });
            matrix[role][resource][action] = matchingRp?.scope ?? '—';
          }
        }
      }

      return controllerResponse.success({ roles, resources, actions: [...actions], matrix });
    });
  }
}

export const permissionController = new PermissionController();
