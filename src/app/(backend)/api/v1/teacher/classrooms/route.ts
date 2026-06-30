import { NextRequest } from 'next/server';
import { classroomController } from '@/server/controllers/classroom.controller';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      const result = await classroomController.create(ctx, body);

      if (result.success && result.data) {
        const res = toNextResponse(result);
        res.cookies.set('active_org_id', (result.data as { id: string }).id, {
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
          sameSite: 'lax',
        });
        return res;
      }

      return toNextResponse(result);
    },
    { allowedRoles: [UserRole.TEACHER, UserRole.SYS_ADMIN] },
  );
}
