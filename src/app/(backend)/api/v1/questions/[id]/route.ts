/**
 * @swagger
 * /api/v1/questions/{id}:
 *   get:
 *     summary: Get question by ID
 *     description: Returns a single question with its answers. Public endpoint.
 *     tags:
 *       - Questions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Question ID
 *     responses:
 *       200:
 *         description: Question found
 *       404:
 *         description: Question not found
 *   put:
 *     summary: Update a question
 *     description: Updates a question. Only the creator can update.
 *     tags:
 *       - Questions
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Question ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subjectId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *                 enum: [mcq, true_false, open]
 *               content:
 *                 type: string
 *               explanation:
 *                 type: string
 *               difficulty:
 *                 type: string
 *                 enum: [easy, medium, hard]
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - content
 *                     - isCorrect
 *                   properties:
 *                     content:
 *                       type: string
 *                     isCorrect:
 *                       type: boolean
 *                     orderIndex:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Question updated successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete a question
 *     description: Deletes a question. Only the creator can delete.
 *     tags:
 *       - Questions
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Question ID
 *     responses:
 *       200:
 *         description: Question deleted successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (not the creator)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { questionController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const response = await questionController.getById(id);
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
  const response = await questionController.update(id, body, user.id);
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
  const response = await questionController.delete(id, user.id);
  return toNextResponse(response);
}
