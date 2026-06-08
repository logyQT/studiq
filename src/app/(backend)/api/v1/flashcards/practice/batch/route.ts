/**
 * @swagger
 * /api/v1/flashcards/practice/batch:
 *   post:
 *     summary: Batch update practice results
 *     description: Logs multiple practice results and updates spaced repetition state in one call. Used for periodic sync during study sessions.
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
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - flashcardId
 *                     - wasCorrect
 *                   properties:
 *                     flashcardId:
 *                       type: string
 *                       format: uuid
 *                     wasCorrect:
 *                       type: boolean
 *                     confidenceLevel:
 *                       type: integer
 *                       minimum: 1
 *                       maximum: 5
 *                     sessionId:
 *                       type: string
 *                       format: uuid
 *     responses:
 *       200:
 *         description: Batch processed successfully
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
    return toNextResponse(await flashcardPracticeController.batch(body, ctx));
  });
}
