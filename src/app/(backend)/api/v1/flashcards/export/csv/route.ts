import { flashcardExportController } from '@studiq/server/controllers/flashcard-export.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const query: Record<string, string | null> = {};
    for (const [key, value] of searchParams.entries()) {
      query[key] = value;
    }

    const response = await flashcardExportController.exportCsv(query, ctx);

    if (!response.success) {
      return toNextResponse(response);
    }

    const csv = response.data as string;
    const deckId = searchParams.get('deckId');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="flashcards-${deckId ?? 'all'}-${Date.now()}.csv"`,
      },
    });
  });
}
