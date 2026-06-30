/**
 * @swagger
 * /api/v1/organization/invitations:
 *   post:
 *     summary: Send invitation to organization
 *     description: Generates an invitation token for a student or teacher and sends email. Requires university_admin permissions.
 *     tags:
 *       - Organization
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateInviteRequest'
 *     responses:
 *       201:
 *         description: Invitation sent successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { invitationController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await invitationController.create(ctx, body));
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token') || '';
  const response = await invitationController.getByToken(token);
  return toNextResponse(response);
}
