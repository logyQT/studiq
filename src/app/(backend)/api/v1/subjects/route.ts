import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { subjectController } from '@/server/controllers';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await subjectController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await subjectController.list(ctx));
  });
}
