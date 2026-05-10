/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: User login
 *     description: Authenticates a user based on their email address and password. Establishes a secure server-side session using HttpOnly cookies.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Successfully logged in. Establishes a secure server-side session.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       401:
 *         description: Invalid login credentials (incorrect email or password).
 *       400:
 *         description: Input validation error.
 *       500:
 *         description: Internal server error.
 */
import { authController } from '@/server/controllers';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return authController.login(req);
}
