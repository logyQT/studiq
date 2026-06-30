/**
 * @swagger
 * /api/v1/organization/members:
 *   get:
 *     summary: List organization members
 *     description: Returns a list of members for the authenticated user's organization. Requires university_admin or sys_admin role.
 *     tags:
 *       - Organization Members
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [student, teacher, university_admin]
 *         description: Filter members by role
 *     responses:
 *       200:
 *         description: List of organization members
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (user has no organization)
 *       500:
 *         description: Internal server error
 *   put:
 *     summary: Change member role
 *     description: Changes the role of an organization member. Requires university_admin or sys_admin role.
 *     tags:
 *       - Organization Members
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetUserId
 *               - newRole
 *             properties:
 *               targetUserId:
 *                 type: string
 *                 format: uuid
 *               newRole:
 *                 type: string
 *                 enum: [student, teacher, university_admin]
 *     responses:
 *       200:
 *         description: Role changed successfully
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (insufficient permissions)
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Remove a member
 *     description: Removes a member from the organization. Requires university_admin or sys_admin role.
 *     tags:
 *       - Organization Members
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the user to remove
 *     responses:
 *       200:
 *         description: Member removed successfully
 *       400:
 *         description: Missing or invalid userId
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (insufficient permissions)
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { organizationMemberController } from '@/server/controllers/organization-member.controller';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const { searchParams } = new URL(req.url);
      const roleFilter = searchParams.get('role') || undefined;
      return toNextResponse(await organizationMemberController.listMembers(ctx, roleFilter));
    },
    { allowedRoles: [UserRole.UNIVERSITY_ADMIN, UserRole.TEACHER] },
  );
}

export async function PUT(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      return toNextResponse(await organizationMemberController.changeRole(ctx, body));
    },
    { allowedRoles: [UserRole.UNIVERSITY_ADMIN] },
  );
}

export async function DELETE(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const { searchParams } = new URL(req.url);
      const targetUserId = searchParams.get('userId') || '';
      return toNextResponse(await organizationMemberController.removeMember(ctx, targetUserId));
    },
    { allowedRoles: [UserRole.UNIVERSITY_ADMIN] },
  );
}
