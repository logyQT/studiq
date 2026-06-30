/**
 * @swagger
 * /api/v1/admin/organizations:
 *   get:
 *     summary: List all organizations
 *     description: Returns a list of all organizations in the system. Requires sys_admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of organizations
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/OrganizationResponse'
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Create a new organization
 *     description: Creates a new organization structure in the system. Requires sys_admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOrganizationRequest'
 *     responses:
 *       201:
 *         description: Organization created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       409:
 *         description: Organization slug is already taken
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { organizationController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      return toNextResponse(await organizationController.getAll());
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      const body = await req.json();
      return toNextResponse(await organizationController.create(body));
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}
