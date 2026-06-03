/**
 * @swagger
 * /api/v1/flashcards/practice/due/count:
 *   get:
 *     summary: Get count of due flashcards
 *     description: Returns the number of flashcards due for review.
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
 *     responses:
 *       200:
 *         description: Due count retrieved
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

    return toNextResponse(
      await flashcardPracticeController.getDueCount(ctx, { topicIds, spaceIds }),
    );
  });
}
