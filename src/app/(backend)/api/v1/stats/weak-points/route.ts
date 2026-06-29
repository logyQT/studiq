import { NextRequest } from 'next/server';
import { statsController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await statsController.getWeakPoints(ctx));
  });
}
