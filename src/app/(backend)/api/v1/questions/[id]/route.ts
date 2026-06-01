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
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await questionController.getById(id, ctx));
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const body = await req.json();
    return toNextResponse(await questionController.update(id, body, ctx));
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await questionController.delete(id, ctx));
  });
}
