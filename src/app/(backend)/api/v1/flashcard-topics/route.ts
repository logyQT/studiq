import { NextRequest, NextResponse } from 'next/server';
import { flashcardTopicService } from '@/server/services';
import { CreateTopicSchema } from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';
import { z } from '@/lib/zod';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateTopicSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.VALIDATION_FAILED, issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }
    const topic = await flashcardTopicService.create(parsed.data);
    return NextResponse.json(topic, { status: 201 });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function GET() {
  try {
    const topics = await flashcardTopicService.list();
    return NextResponse.json(topics);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
