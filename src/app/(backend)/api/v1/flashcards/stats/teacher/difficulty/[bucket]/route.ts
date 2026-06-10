/**
 * @swagger
 * /api/v1/flashcards/stats/teacher/difficulty/{bucket}:
 *   get:
 *     summary: Get flashcards in a difficulty bucket
 *     description: Returns all teacher-owned flashcards classified into the given difficulty bucket, with per-card practice stats.
 *     tags:
 *       - Flashcard Stats
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: bucket
 *         required: true
 *         schema:
 *           type: string
 *           enum: [easy, medium, hard, new]
 *         description: Difficulty bucket to retrieve
 *     responses:
 *       200:
 *         description: Flashcard list for the bucket
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Invalid bucket value
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardStatsController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bucket: string }> },
) {
  return withAuth(_req, async (ctx) => {
    const { bucket } = await params;
    return toNextResponse(await flashcardStatsController.getDifficultyCards({ bucket }, ctx));
  });
}
