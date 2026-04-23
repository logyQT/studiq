import { NextResponse } from "next/server";
import { HealthController } from "@/server/controllers/health.controller";

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check
 *     description: Returns the current health status of the API, including uptime and environment information.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy and running.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2026-04-23T13:24:14.592Z"
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds.
 *                   example: 1153.8349764
 *                 environment:
 *                   type: string
 *                   example: "development"
 *       503:
 *         description: Service is unavailable or unhealthy.
 */
export async function GET() {
  const healthData = HealthController.getStatus();

  return NextResponse.json(healthData);
}
