/**
 * @swagger
 * /api/v1/questions:
 *   get:
 *     summary: List questions
 *     description: Returns a list of questions with optional filters. Public endpoint.
 *     tags:
 *       - Questions
 *     parameters:
 *       - in: query
 *         name: subjectId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by subject ID
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [mcq, true_false, open]
 *         description: Filter by question type
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: string
 *           enum: [easy, medium, hard]
 *         description: Filter by difficulty level
 *     responses:
 *       200:
 *         description: List of questions
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Create a question
 *     description: Creates a new question with answers. Requires authentication.
 *     tags:
 *       - Questions
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - content
 *               - difficulty
 *               - answers
 *             properties:
 *               subjectId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *                 enum: [mcq, true_false, open]
 *               content:
 *                 type: string
 *                 minLength: 1
 *               explanation:
 *                 type: string
 *               difficulty:
 *                 type: string
 *                 enum: [easy, medium, hard]
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - content
 *                     - isCorrect
 *                   properties:
 *                     content:
 *                       type: string
 *                     isCorrect:
 *                       type: boolean
 *                     orderIndex:
 *                       type: integer
 *     responses:
 *       201:
 *         description: Question created successfully
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { questionController } from '@/server/controllers';
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
  const response = await questionController.create(body, user.id);
  return toNextResponse(response);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subjectId = searchParams.get('subjectId') || undefined;
  const type = searchParams.get('type') || undefined;
  const difficulty = searchParams.get('difficulty') || undefined;

  const filters: { subjectId?: string; type?: string; difficulty?: string } = {};
  if (subjectId) filters.subjectId = subjectId;
  if (type) filters.type = type;
  if (difficulty) filters.difficulty = difficulty;

  const response = await questionController.list(
    Object.keys(filters).length > 0 ? filters : undefined,
  );
  return toNextResponse(response);
}
