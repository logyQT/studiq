import { AccountType } from '@studiq/authz';
import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { teacherAssignmentController } from '@/server/controllers/teacher-assignment.controller';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      return toNextResponse(await teacherAssignmentController.getById(id, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      const body = await req.json();
      return toNextResponse(await teacherAssignmentController.update(id, body, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      return toNextResponse(await teacherAssignmentController.delete(id, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}
