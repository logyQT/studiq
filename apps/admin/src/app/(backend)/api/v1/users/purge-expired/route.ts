import { userAdminController } from '@admin/server/controllers/user-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

// Hard-deletes accounts whose 30-day grace period has elapsed. listUsers()
// already calls this lazily on every list load; this route exists so a
// real scheduler (Supabase pg_cron, Vercel Cron, etc. -- none configured
// in this repo yet) can trigger it independently of admin traffic.
export async function POST() {
  return toNextResponse(await userAdminController.purgeExpired());
}
