import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { teacherAssignmentController } from '@/server/controllers/teacher-assignment.controller';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await teacherAssignmentController.listForStudent(ctx));
  });
}
