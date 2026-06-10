import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      const supabase = await createClient();

      const { data: permissions, error: permError } = await supabase
        .from('permissions')
        .select('id, name')
        .order('name');

      if (permError || !permissions) {
        return toNextResponse({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
      }

      const { data: rolePerms, error: rpError } = await supabase
        .from('role_permissions')
        .select('role, scope, permission_id');

      if (rpError || !rolePerms) {
        return toNextResponse({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
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

      return toNextResponse({
        success: true,
        statusCode: 200,
        data: { roles, resources, actions: [...actions], matrix },
      });
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}
