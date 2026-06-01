/**
 * @swagger
 * /api/v1/flashcards/topics/{id}:
 *   get:
 *     summary: Get flashcard topic by ID
 *     description: Returns a single flashcard topic. Public endpoint.
 *     tags:
 *       - Flashcard Topics
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Topic ID
 *     responses:
 *       200:
 *         description: Topic found
 *       404:
 *         description: Topic not found
 *   put:
 *     summary: Update a flashcard topic
 *     description: Updates a flashcard topic. Only the creator can update.
 *     tags:
 *       - Flashcard Topics
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Topic ID
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
 *         description: Topic updated successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete a flashcard topic
 *     description: Deletes a flashcard topic. Only the creator can delete.
 *     tags:
 *       - Flashcard Topics
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Topic ID
 *     responses:
 *       200:
 *         description: Topic deleted successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardTopicController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => {
    const { id } = await params;
    return toNextResponse(await flashcardTopicController.getById(id));
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const body = await req.json();
    return toNextResponse(await flashcardTopicController.update(id, body, ctx));
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await flashcardTopicController.delete(id, ctx));
  });
}
