/**
 * @swagger
 * /api/v1/flashcards/topics:
 *   get:
 *     summary: List flashcard topics
 *     description: Returns a list of flashcard topics for the authenticated user.
 *     tags:
 *       - Flashcard Topics
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of flashcard topics
 *       401:
 *         description: Unauthorized (no session)
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Create a flashcard topic
 *     description: Creates a new flashcard topic. Requires authentication.
 *     tags:
 *       - Flashcard Topics
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
 *         description: Topic created successfully
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardTopicController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await flashcardTopicController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await flashcardTopicController.list(ctx));
  });
}
