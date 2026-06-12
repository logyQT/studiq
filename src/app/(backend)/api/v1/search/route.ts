/**
 * @swagger
 * /api/v1/search:
 *   get:
 *     summary: Global full-text search across flashcards
 *     description: Performs bilingual (English + Polish) full-text search across flashcards. Extensible to other domains in the future.
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Maximum number of results
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Search results returned
 *       422:
 *         description: Invalid query
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { searchController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') ?? '';
    const limit = parseInt(searchParams.get('limit') ?? '10', 10);

    const response = await searchController.search({ q, limit }, ctx);
    return toNextResponse(response);
  });
}
