import { NextRequest, NextResponse } from 'next/server';
import { quizService } from '@/server/services';
import { SubmitQuizAttemptSchema } from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';
import { z } from '@/lib/zod';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  try {
    const { attemptId } = await params;
    const attempt = await quizService.getAttemptDetails(attemptId);
    return NextResponse.json(attempt);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  try {
    const { attemptId } = await params;
    const body = await req.json();
    const parsed = SubmitQuizAttemptSchema.safeParse({
      ...body,
      attemptId,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.VALIDATION_FAILED, issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }

    const result = await quizService.submitAttempt(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
