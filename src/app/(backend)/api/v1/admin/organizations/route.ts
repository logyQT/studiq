import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';
import { withAuth } from '@/lib/with-auth';
import { organizationController } from '@/server/controllers';
import { seedDefaultOrgRoles } from '@/server/services/classroom.service';
import { AccountType } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      return toNextResponse(await organizationController.getAll());
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      const result = await organizationController.create(body, ctx);

      if (result.success && result.data) {
        const org = result.data as { id: string };
        const supabase = await createClient();
        const adminRoleId = await seedDefaultOrgRoles(supabase, org.id);

        await supabase.from('org_members').insert({
          organization_id: org.id,
          user_id: ctx.userId,
          org_role_id: adminRoleId,
        });
      }

      return toNextResponse(result);
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}
