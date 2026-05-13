/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: User registration
 *     description: Registers a new user account based on the provided details.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Account created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: "true"
 *                 message:
 *                   type: string
 *                   example: "SUCCESS_ACTIVATION_LINK_SENT"
 *       400:
 *         description: Input validation error.
 */
import { authController } from '@/server/controllers';
import { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const response = await authController.register(body);
  return toNextResponse(response);
}
