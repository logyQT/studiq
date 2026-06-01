/**
 * @swagger
 * /api/v1/flashcards/spaces:
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
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await flashcardSpaceController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await flashcardSpaceController.list(ctx));
  });
}
