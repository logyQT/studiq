import { NextRequest, NextResponse } from 'next/server';
import { subjectService } from '@/server/services';
import { CreateSubjectSchema } from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';
import { z } from '@/lib/zod';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateSubjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.VALIDATION_FAILED, issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }
    const subject = await subjectService.create(parsed.data);
    return NextResponse.json(subject, { status: 201 });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const universityId = searchParams.get('universityId') || undefined;
    const subjects = await subjectService.list(universityId);
    return NextResponse.json(subjects);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
