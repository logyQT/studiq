/**
 * @swagger
 * /api/v1/flashcards/{id}:
 *   get:
 *     summary: Get flashcard by ID
 *     description: Returns a single flashcard. Public endpoint.
 *     tags:
 *       - Flashcards
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
 *         description: Flashcard found
 *       404:
 *         description: Flashcard not found
 *   put:
 *     summary: Update a flashcard
 *     description: Updates a flashcard. Only the creator can update.
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
 *         description: Flashcard ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
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
 *       200:
 *         description: Flashcard updated successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete a flashcard
 *     description: Deletes a flashcard. Only the creator can delete.
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
 *         description: Flashcard ID
 *     responses:
 *       200:
 *         description: Flashcard deleted successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const response = await flashcardController.getById(id);
  return toNextResponse(response);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { id } = await params;
  const body = await req.json();
  const response = await flashcardController.update(id, body, user.id);
  return toNextResponse(response);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { id } = await params;
  const response = await flashcardController.delete(id, user.id);
  return toNextResponse(response);
}
