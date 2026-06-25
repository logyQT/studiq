/**
 * @swagger
 * /api/v1/flashcards:
 *   get:
 *     summary: List flashcards
 *     description: Returns a list of flashcards scoped to the authenticated user's organization. Requires authentication.
 *     tags:
 *       - Flashcards
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: topicIds
 *         schema:
 *           type: string
 *         description: Comma-separated list of topic IDs to filter by
 *       - in: query
 *         name: deckIds
 *         schema:
 *           type: string
 *         description: Comma-separated list of deck IDs to filter by
 *     responses:
 *       200:
 *         description: List of flashcards
 *       401:
 *         description: Unauthorized (no session)
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Create a flashcard
 *     description: Creates a new flashcard. Teachers' flashcards are scoped to their university. Requires authentication.
 *     tags:
 *       - Flashcards
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - front
 *               - back
 *             properties:
 *               front:
 *                 type: string
 *                 minLength: 1
 *               back:
 *                 type: string
 *                 minLength: 1
 *               topicIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               deckIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       201:
 *         description: Flashcard created successfully
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await flashcardController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const topicIds = searchParams.get('topicIds')?.split(',').filter(Boolean);
    const deckIds = searchParams.get('deckIds')?.split(',').filter(Boolean);
    const q = searchParams.get('q') ?? undefined;
    const sortBy = searchParams.get('sortBy') ?? undefined;
    const sortOrder = searchParams.get('sortOrder') ?? undefined;
    const cursor = searchParams.get('cursor') ?? undefined;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
    const filters: { topicIds?: string[]; deckIds?: string[]; q?: string; sortBy?: string; sortOrder?: string; cursor?: string; limit?: number } = {};
    if (topicIds && topicIds.length > 0) filters.topicIds = topicIds;
    if (deckIds && deckIds.length > 0) filters.deckIds = deckIds;
    if (q) filters.q = q;
    if (sortBy) filters.sortBy = sortBy;
    if (sortOrder) filters.sortOrder = sortOrder;
    if (cursor) filters.cursor = cursor;
    if (limit) filters.limit = limit;

    return toNextResponse(
      await flashcardController.list(ctx, Object.keys(filters).length > 0 ? filters : undefined),
    );
  });
}

