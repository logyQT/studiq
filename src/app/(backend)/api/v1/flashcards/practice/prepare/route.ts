/**
 * @swagger
 * /api/v1/flashcards/practice/prepare:
 *   get:
 *     summary: Prepare practice session cards
 *     description: Returns all flashcards in the specified deck(s) with their SM-2 review state. Filters out mastered cards on the client.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: deckIds
 *         schema:
 *           type: string
 *         description: Comma-separated deck IDs to prepare cards from
 *       - in: query
 *         name: topicIds
 *         schema:
 *           type: string
 *         description: Comma-separated topic IDs to filter by
 *     responses:
 *       200:
 *         description: Practice cards retrieved with review state
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
    const deckIds = searchParams.get('deckIds')?.split(',').filter(Boolean);
    const topicIds = searchParams.get('topicIds')?.split(',').filter(Boolean);

    return toNextResponse(
      await flashcardPracticeController.prepare(ctx, { deckIds, topicIds }),
    );
  });
}
