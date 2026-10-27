import {
  type QuestionExportFile,
  questionTransferController,
} from '@studiq/server/controllers/question-transfer.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const { searchParams } = new URL(req.url);

    const response = await questionTransferController.exportBank(
      id,
      { format: searchParams.get('format') ?? undefined },
      ctx,
    );
    if (!response.success) return toNextResponse(response);

    const file = response.data as QuestionExportFile;
    return new NextResponse(file.body, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
      },
    });
  });
}
