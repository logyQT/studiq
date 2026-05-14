/**
 * @swagger
 * /api/v1/subjects:
 *   post:
 *     summary: Create a new subject
 *     description: Creates a new subject. Requires authentication.
 *     tags:
 *       - Subjects
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSubjectRequest'
 *     responses:
 *       201:
 *         description: Subject created successfully
 *       401:
 *         description: Unauthorized (no session)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   get:
 *     summary: List all subjects
 *     description: Returns a list of subjects. Optionally filter by universityId. Public endpoint.
 *     tags:
 *       - Subjects
 *     parameters:
 *       - in: query
 *         name: universityId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter subjects by university ID
 *     responses:
 *       200:
 *         description: List of subjects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Subject'
 */
import { NextRequest } from 'next/server';
import { subjectController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await subjectController.create(body, user.id);
  return toNextResponse(response);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const universityId = searchParams.get('universityId') || undefined;

  const response = await subjectController.list(universityId);
  return toNextResponse(response);
}
