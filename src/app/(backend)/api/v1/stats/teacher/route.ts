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
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { searchParams } = new URL(req.url);
  const subjectId = searchParams.get('subjectId') || undefined;

  const response = await statsController.getTeacherStats(user.id, subjectId);
  return toNextResponse(response);
}
