import { NextRequest, NextResponse } from 'next/server';
import { subjectService } from '@/server/services';
import { UpdateSubjectSchema } from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';
import { z } from '@/lib/zod';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const subject = await subjectService.getById(id);
    return NextResponse.json(subject);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = UpdateSubjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.VALIDATION_FAILED, issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }
    const subject = await subjectService.update(id, parsed.data);
    return NextResponse.json(subject);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await subjectService.delete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
