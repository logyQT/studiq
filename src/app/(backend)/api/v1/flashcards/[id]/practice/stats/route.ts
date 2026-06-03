/**
 * @swagger
 * /api/v1/flashcards/{id}/practice/stats:
 *   get:
 *     summary: Get flashcard practice stats
 *     description: Returns aggregate statistics for a flashcard.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Flashcard ID
 *     responses:
 *       200:
 *         description: Practice stats retrieved
 *       401:
 *         description: Unauthorized (no session)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardPracticeController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await flashcardPracticeController.getStatsForFlashcard(id, ctx));
  });
}
