/**
 * @swagger
 * /api/v1/quiz-attempts:
 *   get:
 *     summary: List quiz attempts
 *     description: Returns a list of quiz attempts for the authenticated user.
 *     tags:
 *       - Quiz Attempts
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

import { quizAttemptController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const response = await quizAttemptController.list(user.id);
  return toNextResponse(response);
}
