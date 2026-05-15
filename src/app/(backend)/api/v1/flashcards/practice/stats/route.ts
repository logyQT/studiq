/**
 * @swagger
 * /api/v1/flashcards/practice/stats:
 *   get:
 *     summary: Get aggregate flashcard practice stats (not implemented)
 *     description: Returns aggregate statistics across all flashcards created by the teacher. Not yet implemented.
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       401:
 *         description: Unauthorized (no session)
 *       501:
 *         description: Not implemented
 */

import { NextRequest } from 'next/server';
import { flashcardPracticeController } from '@/server/controllers';
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

  const response = await flashcardPracticeController.getStatsAll();
  return toNextResponse(response);
}
