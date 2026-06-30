/**
 * @swagger
 * /api/v1/admin/organizations/{id}:
 *   get:
 *     summary: Get organization by ID
 *     description: Returns a single organization by its ID. Requires sys_admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Organization ID
 *     responses:
 *       200:
 *         description: Organization details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrganizationResponse'
 *       400:
 *         description: Invalid organization ID format
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       404:
 *         description: Organization not found
 *       500:
 *         description: Internal server error
 *   put:
 *     summary: Update organization
 *     description: Updates an organization's name and/or slug. Requires sys_admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Organization ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateOrganizationRequest'
 *     responses:
 *       200:
 *         description: Organization updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrganizationResponse'
 *       400:
 *         description: Invalid organization ID format
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       404:
 *         description: Organization not found
 *       409:
 *         description: Organization slug is already taken
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete organization
 *     description: Deletes an organization by its ID. Requires sys_admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Organization ID
 *     responses:
 *       200:
 *         description: Organization deleted successfully
 *       400:
 *         description: Invalid organization ID format
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       404:
 *         description: Organization not found
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { organizationController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async () => {
      const { id } = await params;
      return toNextResponse(await organizationController.getById(id));
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async () => {
      const { id } = await params;
      const body = await req.json();
      return toNextResponse(await organizationController.update(id, body));
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async () => {
      const { id } = await params;
      return toNextResponse(await organizationController.delete(id));
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}
