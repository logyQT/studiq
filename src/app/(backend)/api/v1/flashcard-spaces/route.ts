/**
 * @swagger
 * /api/v1/flashcard-spaces:
 *   get:
 *     summary: List flashcard spaces
 *     description: Returns a list of flashcard spaces for the authenticated user.
 *     tags:
 *       - Flashcard Spaces
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of flashcard spaces
 *       401:
 *         description: Unauthorized (no session)
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Create a flashcard space
 *     description: Creates a new flashcard space. Requires authentication.
 *     tags:
 *       - Flashcard Spaces
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *     responses:
 *       201:
 *         description: Space created successfully
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardSpaceController } from '@/server/controllers';
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
  const response = await flashcardSpaceController.create(body, user.id);
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

  const response = await flashcardSpaceController.list(user.id);
  return toNextResponse(response);
}
