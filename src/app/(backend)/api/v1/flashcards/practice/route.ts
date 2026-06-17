/**
 * @swagger
 * /api/v1/flashcards/practice:
 *   get:
 *     summary: Get all flashcard practice history (deprecated)
 *     description: This endpoint is deprecated. Practice history is now tracked within study sessions.
 *     deprecated: true
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Returns empty array
 *       401:
 *         description: Unauthorized (no session)
 *
 *   post:
 *     summary: This endpoint is deprecated
 *     description: Use POST /api/v1/flashcards/practice/batch instead.
 *     deprecated: true
 *     tags:
 *       - Flashcard Practice
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Returns empty array
 *       401:
 *         description: Unauthorized (no session)
 */

import { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    return toNextResponse({ success: true, statusCode: 200, data: [] });
  });
}
