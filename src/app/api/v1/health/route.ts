import { NextResponse } from "next/server";
import { HealthController } from "@/server/controllers/health.controller";

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check
 *     description: Returns the current health status of the API, including service-level health, uptime, and environment information.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy or degraded but still operational.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, degraded]
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
 *                 responseTime:
 *                   type: number
 *                   description: Health check execution time in milliseconds.
 *                   example: 42
 *                 services:
 *                   type: object
 *                   properties:
 *                     supabase:
 *                       type: string
 *                       enum: [up, down]
 *                       example: "up"
 *
 *       503:
 *         description: Service is unhealthy and not operational.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "unhealthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2026-04-23T13:24:14.592Z"
 *                 uptime:
 *                   type: number
 *                   example: 1153.8349764
 *                 environment:
 *                   type: string
 *                   example: "development"
 *                 responseTime:
 *                   type: number
 *                   example: 42
 *                 services:
 *                   type: object
 *                   properties:
 *                     supabase:
 *                       type: string
 *                       enum: [up, down]
 *                       example: "down"
 */
export async function GET() {
  const { body, statusCode } = await HealthController.getStatus();

  return NextResponse.json(body, { status: statusCode });
}