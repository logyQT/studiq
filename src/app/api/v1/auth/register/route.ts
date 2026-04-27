import { authController } from '@/server/controllers';

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
export async function POST(req: Request) {
  return authController.register(req);
}
