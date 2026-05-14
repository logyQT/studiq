/**
 * @swagger
 * /api/v1/quiz-attempts/{attemptId}:
 *   get:
 *     summary: Get quiz attempt details
 *     description: Returns details of a specific quiz attempt including questions and answers. Only the owner can view.
 *     tags:
 *       - Quiz Attempts
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Quiz attempt ID
 *     responses:
 *       200:
 *         description: Quiz attempt details
 *       401:
 *         description: Unauthorized (no session)
 *       404:
 *         description: Attempt not found or not owned by user
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Submit quiz attempt
 *     description: Submits answers for a quiz attempt and calculates the score.
 *     tags:
 *       - Quiz Attempts
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Quiz attempt ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - answers
 *             properties:
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - questionId
 *                     - selectedAnswerId
 *                   properties:
 *                     questionId:
 *                       type: string
 *                       format: uuid
 *                     selectedAnswerId:
 *                       type: string
 *                       format: uuid
 *     responses:
 *       200:
 *         description: Quiz submitted with score
 *       400:
 *         description: Attempt already completed
 *       401:
 *         description: Unauthorized (no session)
 *       404:
 *         description: Attempt not found
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { quizAttemptController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { attemptId } = await params;
  const response = await quizAttemptController.getDetails(attemptId, user.id);
  return toNextResponse(response);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { attemptId } = await params;
  const body = await req.json();
  const response = await quizAttemptController.submit(body, attemptId, user.id);
  return toNextResponse(response);
}
