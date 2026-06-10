/**
 * @swagger
 * /api/v1/quiz/attempts:
 *   get:
 *     summary: List quiz attempts
 *     description: Returns a list of quiz attempts for the authenticated user.
 *     tags:
 *       - Quiz
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of quiz attempts
 *       401:
 *         description: Unauthorized (no session)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { quizAttemptController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await quizAttemptController.list(ctx));
  });
}
