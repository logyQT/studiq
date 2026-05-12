import { NextRequest, NextResponse } from 'next/server';
import { flashcardService } from '@/server/services';
import { AppErrorCode, handleApiError } from '@/lib/errors';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { flashcardId, wasCorrect } = body;
    if (!flashcardId || wasCorrect === undefined) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.INVALID_INPUT },
        { status: 400 },
      );
    }
    const result = await flashcardService.logPractice(flashcardId, wasCorrect);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function GET() {
  try {
    const history = await flashcardService.getPracticeHistory();
    return NextResponse.json(history);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
