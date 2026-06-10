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
import { invitationController } from '@/server/controllers/invitation.controller';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await invitationController.createBulk(ctx, body));
  });
}
