import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { questionController } from '@/server/controllers';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await questionController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);

    const subjectId = searchParams.get('subjectId') || undefined;
    const type = searchParams.get('type') || undefined;
    const filters: Record<string, string> = {};
    if (subjectId) filters.subjectId = subjectId;
    if (type) filters.type = type;

    return toNextResponse(
      await questionController.list(ctx, Object.keys(filters).length > 0 ? filters : undefined),
    );
  });
}
