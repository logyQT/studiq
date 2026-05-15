/**
 * @swagger
 * /api/v1/flashcards/{id}/practice:
 *   post:
 *     summary: Log flashcard practice
 *     description: Logs a practice attempt for a specific flashcard. Requires authentication.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Flashcard ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wasCorrect
 *             properties:
 *               wasCorrect:
 *                 type: boolean
 *               responseTimeMs:
 *                 type: integer
 *                 description: Time taken to answer in milliseconds
 *               confidenceLevel:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 description: Self-reported confidence level
 *               sessionId:
 *                 type: string
 *                 format: uuid
 *                 description: Study session identifier
 *     responses:
 *       201:
 *         description: Practice logged successfully
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   get:
 *     summary: Get practice history for a flashcard
 *     description: Returns practice history for the authenticated user on a specific flashcard.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Flashcard ID
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
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { id } = await params;
  const body = await req.json();
  const response = await flashcardPracticeController.log(id, body, user.id);
  return toNextResponse(response);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { id } = await params;
  const response = await flashcardPracticeController.getHistoryForFlashcard(id, user.id);
  return toNextResponse(response);
}
