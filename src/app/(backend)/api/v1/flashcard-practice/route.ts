/**
 * @swagger
 * /api/v1/flashcard-practice:
 *   get:
 *     summary: Get flashcard practice history
 *     description: Returns practice history for the authenticated user.
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
 *   post:
 *     summary: Log flashcard practice
 *     description: Logs a flashcard practice session. Requires authentication.
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
 *               - flashcardId
 *               - wasCorrect
 *             properties:
 *               flashcardId:
 *                 type: string
 *                 format: uuid
 *               wasCorrect:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Practice logged successfully
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardPracticeController } from '@/server/controllers';
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
  const response = await flashcardPracticeController.log(body, user.id);
  return toNextResponse(response);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const response = await flashcardPracticeController.getHistory(user.id);
  return toNextResponse(response);
}
