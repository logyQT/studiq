/**
 * @swagger
 * /api/v1/flashcards/{id}/copy:
 *   post:
 *     summary: Copy a flashcard to another deck
 *     description: Creates a new independent flashcard with the same content in the target deck. The copied flashcard will have a new ID and will not sync with the original. User must own the target deck.
 *     tags:
 *       - Flashcards
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Flashcard ID to copy from
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetDeckId
 *             properties:
 *               targetDeckId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Flashcard copied successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (no access to source flashcard or target deck)
 *       404:
 *         description: Source flashcard not found
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const body = await req.json();
    return toNextResponse(await flashcardController.copy(id, body, ctx));
  });
}
