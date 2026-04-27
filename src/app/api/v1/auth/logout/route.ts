import { authController } from '@/server/controllers';

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: User logout
 *     description: Invalidates the user session and clears authentication cookies.
 *     tags:
 *       - Auth
 *     responses:
 *       200:
 *         description: Successfully logged out. Session cookies are cleared.
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
 *                   example: "SUCCESS_LOGOUT"
 *       500:
 *         description: Internal server error during logout process.
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
 *                   example: "ERROR_LOGOUT_FAILED"
 */
export async function POST() {
  return authController.logout();
}
