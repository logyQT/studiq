import { NextResponse } from 'next/server';
import { quizService } from '@/server/services';
import { AppErrorCode, handleApiError } from '@/lib/errors';

export async function GET() {
  try {
    const attempts = await quizService.getUserAttempts();
    return NextResponse.json(attempts);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
