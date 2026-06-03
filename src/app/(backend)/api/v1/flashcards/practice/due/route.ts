/**
 * @swagger
 * /api/v1/flashcards/practice/due:
 *   get:
 *     summary: Get due flashcards for practice
 *     description: Returns flashcards due for review based on SM-2 spaced repetition.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: topicIds
 *         schema:
 *           type: string
 *         description: Comma-separated topic IDs to filter by
 *       - in: query
 *         name: spaceIds
 *         schema:
 *           type: string
 *         description: Comma-separated space IDs to filter by
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of cards to return
 *     responses:
 *       200:
 *         description: Due flashcards retrieved
 *       401:
 *         description: Unauthorized (no session)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardPracticeController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const topicIds = searchParams.get('topicIds')?.split(',').filter(Boolean);
    const spaceIds = searchParams.get('spaceIds')?.split(',').filter(Boolean);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100);

    return toNextResponse(
      await flashcardPracticeController.getDueCards(ctx, { topicIds, spaceIds }, limit),
    );
  });
}
