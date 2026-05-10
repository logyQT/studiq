/**
 * @swagger
 * /api/v1/auth/password/update:
 *   post:
 *     summary: Update user password
 *     description: Updates the password for the currently authenticated user. Requires an active server-side session obtained from the password reset callback.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePasswordRequest'
 *     responses:
 *       200:
 *         description: Password updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: SUCCESS_PASSWORD_UPDATED
 *       400:
 *         description: Input validation error or password update failed (e.g., expired session).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: ERROR_PASSWORD_UPDATE_FAILED
 */
import { authController } from '@/server/controllers/auth.controller';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return authController.updatePasswordHandler(req);
}
