/**
 * @swagger
 * /api/v1/flashcards/practice:
 *   get:
 *     summary: Get all flashcard practice history
 *     description: Returns practice history for the authenticated user across all flashcards.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Practice history retrieved
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
    return toNextResponse(await flashcardPracticeController.getHistory(ctx));
  });
}
