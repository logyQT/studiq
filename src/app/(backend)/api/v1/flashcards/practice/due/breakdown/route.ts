/**
 * @swagger
 * /api/v1/flashcards/practice/due/breakdown:
 *   get:
 *     summary: Get due count breakdown by topic and deck
 *     description: Returns total due count and per-topic/per-deck breakdowns.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Due breakdown retrieved
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
    return toNextResponse(
      await flashcardPracticeController.getDueBreakdown(ctx),
    );
  });
}
