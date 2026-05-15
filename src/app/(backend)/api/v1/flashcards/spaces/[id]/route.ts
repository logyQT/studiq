/**
 * @swagger
 * /api/v1/flashcards/spaces/{id}:
 *   get:
 *     summary: Get flashcard space by ID
 *     description: Returns a single flashcard space. Only the owner can view.
 *     tags:
 *       - Flashcard Spaces
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Space ID
 *     responses:
 *       200:
 *         description: Space found
 *       401:
 *         description: Unauthorized (no session)
 *       404:
 *         description: Space not found or not owned by user
 *   put:
 *     summary: Update a flashcard space
 *     description: Updates a flashcard space. Only the creator can update.
 *     tags:
 *       - Flashcard Spaces
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Space ID
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
 *         description: Space updated successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete a flashcard space
 *     description: Deletes a flashcard space. Only the creator can delete.
 *     tags:
 *       - Flashcard Spaces
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Space ID
 *     responses:
 *       200:
 *         description: Space deleted successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardSpaceController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { id } = await params;
  const response = await flashcardSpaceController.getById(id, user.id);
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
  const response = await flashcardSpaceController.update(id, body, user.id);
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
  const response = await flashcardSpaceController.delete(id, user.id);
  return toNextResponse(response);
}
