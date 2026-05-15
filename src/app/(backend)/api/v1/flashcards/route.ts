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
 *         name: spaceIds
 *         schema:
 *           type: string
 *         description: Comma-separated list of space IDs to filter by
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
 *               spaceIds:
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
 *   put:
 *     summary: Bulk create flashcards
 *     description: Creates multiple flashcards at once. Teachers' flashcards are scoped to their university. Requires authentication.
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
 *               - cards
 *             properties:
 *               cards:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - front
 *                     - back
 *                   properties:
 *                     front:
 *                       type: string
 *                       minLength: 1
 *                     back:
 *                       type: string
 *                       minLength: 1
 *                     topicIds:
 *                       type: array
 *                       items:
 *                         type: string
 *                         format: uuid
 *                     spaceIds:
 *                       type: array
 *                       items:
 *                         type: string
 *                         format: uuid
 *     responses:
 *       201:
 *         description: Flashcards created successfully
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
import { createClient } from '@/lib/supabase/server';

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await flashcardController.create(body, user.id);
  return toNextResponse(response);
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { searchParams } = new URL(req.url);
  const topicIds = searchParams.get('topicIds')?.split(',').filter(Boolean);
  const spaceIds = searchParams.get('spaceIds')?.split(',').filter(Boolean);
  const filters: { topicIds?: string[]; spaceIds?: string[] } = {};
  if (topicIds && topicIds.length > 0) filters.topicIds = topicIds;
  if (spaceIds && spaceIds.length > 0) filters.spaceIds = spaceIds;

  const response = await flashcardController.list(
    user.id,
    Object.keys(filters).length > 0 ? filters : undefined,
  );
  return toNextResponse(response);
}

export async function PUT(req: NextRequest) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await flashcardController.bulkCreate(body, user.id);
  return toNextResponse(response);
}
