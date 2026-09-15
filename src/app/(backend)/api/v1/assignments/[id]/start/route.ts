import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { teacherAssignmentController } from '@/server/controllers/teacher-assignment.controller';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await teacherAssignmentController.startAttempt(id, ctx));
  });
}
