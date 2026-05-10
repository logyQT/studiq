/**
 * @swagger
 * /api/v1/auth/password/reset:
 *   post:
 *     summary: Request password reset
 *     description: Initiates the password reset flow by sending an email with a reset link to the user (if the email exists in the system).
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *     responses:
 *       200:
 *         description: Password reset instructions sent successfully (or silently accepted to prevent email enumeration).
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
 *                   example: SUCCESS_PASSWORD_RESET_REQUESTED
 *       400:
 *         description: Input validation error (e.g., invalid email format).
 *       500:
 *         description: Internal server error or server misconfiguration.
 */
import { authController } from '@/server/controllers/auth.controller';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return authController.requestPasswordResetHandler(req);
}
