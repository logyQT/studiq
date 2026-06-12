/**
 * @swagger
 * /api/v1/flashcards/practice/sessions/complete:
 *   post:
 *     summary: Complete a study/practice session
 *     description: Stores aggregate session summary data (duration, cards studied, accuracy) for the session history.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - startedAt
 *               - completedAt
 *               - durationMs
 *               - cardsStudied
 *               - cardsCorrect
 *               - mode
 *             properties:
 *               sessionId:
 *                 type: string
 *                 format: uuid
 *               startedAt:
 *                 type: string
 *                 format: date-time
 *               completedAt:
 *                 type: string
 *                 format: date-time
 *               durationMs:
 *                 type: integer
 *               cardsStudied:
 *                 type: integer
 *               cardsCorrect:
 *                 type: integer
 *               deckIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               mode:
 *                 type: string
 *                 enum: [study, practice, quick]
 *     responses:
 *       200:
 *         description: Session completed successfully
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardPracticeController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await flashcardPracticeController.completeSession(body, ctx));
  });
}
