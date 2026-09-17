import { flashcardPracticeController } from '@studiq/server/controllers/flashcard-practice.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const body = await req.json();
    return toNextResponse(await flashcardPracticeController.log(id, body, ctx));
  });
}
