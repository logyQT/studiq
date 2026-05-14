/**
 * @swagger
 * /api/v1/university/invitations/bulk:
 *   post:
 *     summary: Bulk create invitations
 *     description: Creates multiple university invitations at once. Requires university_admin or sys_admin role.
 *     tags:
 *       - Invitations
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - emails
 *               - role
 *             properties:
 *               emails:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: email
 *               role:
 *                 type: string
 *                 enum: [student, teacher, university_admin]
 *               universityId:
 *                 type: string
 *                 format: uuid
 *                 description: Required for sys_admin to specify target university
 *     responses:
 *       200:
 *         description: Invitations created successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (insufficient permissions)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { invitationController } from '@/server/controllers/invitation.controller';
import { toNextResponse } from '@/lib/http-utils';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await invitationController.createBulk(user.id, body);
  return toNextResponse(response);
}
