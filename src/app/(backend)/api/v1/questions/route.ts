import { NextRequest, NextResponse } from 'next/server';
import { questionService } from '@/server/services';
import { CreateQuestionSchema } from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';
import { z } from '@/lib/zod';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateQuestionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.VALIDATION_FAILED, issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }
    const question = await questionService.create(parsed.data);
    return NextResponse.json(question, { status: 201 });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filters = {
      subjectId: searchParams.get('subjectId') || undefined,
      type: searchParams.get('type') || undefined,
      difficulty: searchParams.get('difficulty') || undefined,
    };
    const questions = await questionService.list(filters);
    return NextResponse.json(questions);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
