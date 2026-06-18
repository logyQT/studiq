/**
 * @swagger
 * /api/v1/flashcards/export/csv:
 *   get:
 *     summary: Export flashcards as CSV
 *     description: Returns a CSV file download of all readable flashcards, optionally filtered by deck, flashcard IDs, or deck IDs. Includes topic and deck names.
 *     tags:
 *       - Flashcard Import/Export
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: deckId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Optional deck ID to filter by
 *       - in: query
 *         name: ids
 *         schema:
 *           type: string
 *         description: Comma-separated flashcard IDs to export
 *       - in: query
 *         name: deckIds
 *         schema:
 *           type: string
 *         description: Comma-separated deck IDs to export flashcards from
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *               example: "front,back,topic,deck\n\"What is 2+2?\",\"4\",\"Math\",\"Arithmetic\""
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { flashcardExportController } from '@/server/controllers';

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
