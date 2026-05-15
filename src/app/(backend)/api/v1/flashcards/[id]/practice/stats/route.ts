/**
 * @swagger
 * /api/v1/flashcards/{id}/practice/stats:
 *   get:
 *     summary: Get flashcard practice stats (not implemented)
 *     description: Returns aggregate statistics for a flashcard. Not yet implemented.
 *     tags:
 *       - Flashcard Practice
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Flashcard ID
 *     responses:
 *       501:
 *         description: Not implemented
 */

import { NextRequest } from 'next/server';
import { flashcardPracticeController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const response = await flashcardPracticeController.getStatsForFlashcard(id);
  return toNextResponse(response);
}
