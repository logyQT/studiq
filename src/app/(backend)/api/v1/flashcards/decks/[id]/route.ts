/**
 * @swagger
 * /api/v1/flashcards/decks/{id}:
 *   get:
 *     summary: Get flashcard deck by ID
 *     description: Returns a single flashcard deck. Only the owner can view.
 *     tags:
 *       - Flashcard Decks
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Deck ID
 *     responses:
 *       200:
 *         description: Deck found
 *       401:
 *         description: Unauthorized (no session)
 *       404:
 *         description: Deck not found or not owned by user
 *   put:
 *     summary: Update a flashcard deck
 *     description: Updates a flashcard deck. Only the creator can update.
 *     tags:
 *       - Flashcard Decks
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Deck ID
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
 *       200:
 *         description: Deck updated successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete a flashcard deck
 *     description: Deletes a flashcard deck. Only the creator can delete.
 *     tags:
 *       - Flashcard Decks
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Deck ID
 *     responses:
 *       200:
 *         description: Deck deleted successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardDeckController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await flashcardDeckController.getById(id, ctx));
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const body = await req.json();
    return toNextResponse(await flashcardDeckController.update(id, body, ctx));
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await flashcardDeckController.delete(id, ctx));
  });
}
