/**
 * @swagger
 * /api/v1/quizzes:
 *   post:
 *     summary: Generate a quiz
 *     description: Generates a quiz based on specified criteria (subject, question types, difficulty, count). Requires authentication.
 *     tags:
 *       - Quizzes
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - questionTypes
 *               - questionCount
 *             properties:
 *               subjectId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional subject ID to filter questions
 *               questionTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [mcq, true_false, open]
 *                 description: Types of questions to include
 *               difficulty:
 *                 type: string
 *                 enum: [easy, medium, hard]
 *                 description: Filter by difficulty level
 *               questionCount:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of questions to include
 *     responses:
 *       201:
 *         description: Quiz generated successfully
 *       401:
 *         description: Unauthorized (no session)
 *       404:
 *         description: No matching questions found
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { quizController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await quizController.generate(body, user.id);
  return toNextResponse(response);
}
