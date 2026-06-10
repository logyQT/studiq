/**
 * @swagger
 * /api/v1/flashcards/stats/teacher:
 *   get:
 *     summary: Get teacher flashcard statistics
 *     description: Returns aggregate flashcard practice statistics across all decks and topics for the authenticated teacher.
 *     tags:
 *       - Flashcard Stats
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: deckId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Optional deck ID to filter stats to a single deck
 *     responses:
 *       200:
 *         description: Teacher flashcard statistics retrieved
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Invalid query parameters
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardStatsController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const query = Object.fromEntries(new URL(req.url).searchParams);
    return toNextResponse(await flashcardStatsController.getTeacherStats(query, ctx));
  });
}
