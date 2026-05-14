/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check
 *     description: Returns the health status of the API including uptime, environment, and service status.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: API is healthy or degraded
 *       503:
 *         description: API is unhealthy
 */

import { healthController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';

export async function GET() {
  const response = await healthController.getStatus();
  return toNextResponse(response);
}
