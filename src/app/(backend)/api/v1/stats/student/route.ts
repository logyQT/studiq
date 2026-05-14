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

import { statsController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const response = await statsController.getStudentStats(user.id);
  return toNextResponse(response);
}
