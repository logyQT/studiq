/**
 * @swagger
 * /api/v1/flashcards/import/csv:
 *   post:
 *     summary: Import flashcards from CSV data
 *     description: Accepts parsed CSV rows as JSON. Auto-creates topics and decks referenced by name. Returns import result with per-row errors.
 *     tags:
 *       - Flashcard Import/Export
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deckId
 *               - cards
 *             properties:
 *               deckId:
 *                 type: string
 *                 format: uuid
 *                 description: Target deck ID to import into
 *               cards:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 500
 *                 items:
 *                   type: object
 *                   required:
 *                     - front
 *                     - back
 *                   properties:
 *                     front:
 *                       type: string
 *                       maxLength: 255
 *                     back:
 *                       type: string
 *                       maxLength: 255
 *                     topic:
 *                       type: string
 *                       description: Topic name (auto-created if not found)
 *                     deck:
 *                       type: string
 *                       description: Additional deck name to link to (auto-created if not found)
 *     responses:
 *       200:
 *         description: Import completed with results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 imported:
 *                   type: integer
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       row:
 *                         type: integer
 *                       error:
 *                         type: string
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { flashcardImportController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await flashcardImportController.importCsv(body, ctx));
  });
}
