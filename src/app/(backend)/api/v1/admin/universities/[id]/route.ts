/**
 * @swagger
 * /api/v1/admin/universities/{id}:
 *   get:
 *     summary: Get university by ID
 *     description: Returns a single university by its ID. Requires sys_admin role.
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
 *         description: University ID
 *     responses:
 *       200:
 *         description: University details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UniversityResponse'
 *       400:
 *         description: Invalid university ID format
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       404:
 *         description: University not found
 *       500:
 *         description: Internal server error
 *   put:
 *     summary: Update university
 *     description: Updates a university's name and/or slug. Requires sys_admin role.
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
 *         description: University ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUniversityRequest'
 *     responses:
 *       200:
 *         description: University updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UniversityResponse'
 *       400:
 *         description: Invalid university ID format
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       404:
 *         description: University not found
 *       409:
 *         description: University slug is already taken
 *       422:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete university
 *     description: Deletes a university by its ID. Requires sys_admin role.
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
 *         description: University ID
 *     responses:
 *       200:
 *         description: University deleted successfully
 *       400:
 *         description: Invalid university ID format
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       404:
 *         description: University not found
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { universityController } from '@/server/controllers/university.controller';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async () => {
      const { id } = await params;
      return toNextResponse(await universityController.getById(id));
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
      return toNextResponse(await universityController.update(id, body));
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async () => {
      const { id } = await params;
      return toNextResponse(await universityController.delete(id));
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}
