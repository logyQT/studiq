/**
 * @swagger
 * /api/v1/stats/student:
 *   get:
 *     summary: Get student statistics
 *     description: Returns statistics for the authenticated student including quiz attempts, scores, and flashcard practice.
 *     tags:
 *       - Stats
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Student statistics retrieved
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
    return toNextResponse(await statsController.getStudentStats(ctx));
  });
}
