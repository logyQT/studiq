/**
 * @swagger
 * /api/v1/flashcards/practice/stats:
 *   get:
 *     summary: Get aggregate flashcard practice stats
 *     description: Returns aggregate statistics across all flashcards for the authenticated user.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Aggregate practice stats retrieved
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
    return toNextResponse(await flashcardPracticeController.getStatsAll(ctx));
  });
}
