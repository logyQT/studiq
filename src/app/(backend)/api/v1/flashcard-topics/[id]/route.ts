import { NextRequest, NextResponse } from 'next/server';
import { flashcardTopicService } from '@/server/services';
import { UpdateTopicSchema } from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';
import { z } from '@/lib/zod';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const topic = await flashcardTopicService.getById(id);
    return NextResponse.json(topic);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = UpdateTopicSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.VALIDATION_FAILED, issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }
    const topic = await flashcardTopicService.update(id, parsed.data);
    return NextResponse.json(topic);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await flashcardTopicService.delete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
