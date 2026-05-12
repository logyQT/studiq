import { NextRequest, NextResponse } from 'next/server';
import { flashcardSpaceService } from '@/server/services';
import { CreateSpaceSchema } from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';
import { z } from '@/lib/zod';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateSpaceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.VALIDATION_FAILED, issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }
    const space = await flashcardSpaceService.create(parsed.data);
    return NextResponse.json(space, { status: 201 });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function GET() {
  try {
    const spaces = await flashcardSpaceService.list();
    return NextResponse.json(spaces);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
