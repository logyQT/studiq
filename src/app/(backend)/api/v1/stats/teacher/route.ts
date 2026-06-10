/**
 * @swagger
 * /api/v1/stats/teacher:
 *   get:
 *     summary: Get teacher statistics
 *     description: Returns statistics for the authenticated teacher including questions, flashcards, and subject details.
 *     tags:
 *       - Stats
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: subjectId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Optional subject ID to get detailed stats for a specific subject
 *     responses:
 *       200:
 *         description: Teacher statistics retrieved
 *       401:
 *         description: Unauthorized (no session)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { statsController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const subjectId = searchParams.get('subjectId') || undefined;
    return toNextResponse(await statsController.getTeacherStats(ctx, subjectId));
  });
}
