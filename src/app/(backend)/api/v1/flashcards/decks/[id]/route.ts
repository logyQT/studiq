import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { flashcardDeckController } from '@/server/controllers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await flashcardDeckController.getById(id, ctx));
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const body = await req.json();
    return toNextResponse(await flashcardDeckController.update(id, body, ctx));
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await flashcardDeckController.delete(id, ctx));
  });
}
