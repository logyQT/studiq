/**
 * @swagger
 * /api/v1/admin/universities:
 *   get:
 *     summary: List all universities
 *     description: Returns a list of all universities in the system. Requires sys_admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of universities
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/UniversityResponse'
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Create a new university
 *     description: Creates a new university structure in the system. Requires sys_admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUniversityRequest'
 *     responses:
 *       201:
 *         description: University created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized (no session)
 *       403:
 *         description: Forbidden (sys_admin only)
 *       409:
 *         description: University slug is already taken
 *       500:
 *         description: Internal server error
 */

import { NextRequest } from 'next/server';
import { universityController } from '@/server/controllers/university.controller';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      return toNextResponse(await universityController.getAll());
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      const body = await req.json();
      return toNextResponse(await universityController.create(body));
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}
