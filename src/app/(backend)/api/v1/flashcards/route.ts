import { NextRequest, NextResponse } from 'next/server';
import { flashcardService } from '@/server/services';
import { CreateFlashcardSchema, BulkCreateFlashcardsSchema } from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';
import { z } from '@/lib/zod';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateFlashcardSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.VALIDATION_FAILED, issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }
    const flashcard = await flashcardService.create(parsed.data);
    return NextResponse.json(flashcard, { status: 201 });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const topicIds = searchParams.get('topicIds')?.split(',').filter(Boolean);
    const spaceIds = searchParams.get('spaceIds')?.split(',').filter(Boolean);
    const filters: { topicIds?: string[]; spaceIds?: string[] } = {};
    if (topicIds && topicIds.length > 0) filters.topicIds = topicIds;
    if (spaceIds && spaceIds.length > 0) filters.spaceIds = spaceIds;
    const flashcards = await flashcardService.list(filters);
    return NextResponse.json(flashcards);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = BulkCreateFlashcardsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.VALIDATION_FAILED, issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }
    const flashcards = await flashcardService.bulkCreate(parsed.data);
    return NextResponse.json(flashcards, { status: 201 });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
