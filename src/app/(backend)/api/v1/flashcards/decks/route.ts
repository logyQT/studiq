/**
 * @swagger
 * /api/v1/flashcards/decks:
 *   get:
 *     summary: List flashcard decks
 *     description: Returns a list of flashcard decks for the authenticated user.
 *     tags:
 *       - Flashcard Decks
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of flashcard decks
 *       401:
 *         description: Unauthorized (no session)
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Create a flashcard deck
 *     description: Creates a new flashcard deck. Requires authentication.
 *     tags:
 *       - Flashcard Decks
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
 *         description: Deck created successfully
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardDeckController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await flashcardDeckController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = req.nextUrl;
    const query = {
      q: searchParams.get('q') ?? undefined,
      owner: searchParams.get('owner') ?? undefined,
      sortBy: searchParams.get('sortBy') ?? undefined,
      sortOrder: searchParams.get('sortOrder') ?? undefined,
      cursor: searchParams.get('cursor') ?? undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
      includeSuspended: searchParams.get('includeSuspended') ?? undefined,
    };
    return toNextResponse(await flashcardDeckController.list(query, ctx));
  });
}
