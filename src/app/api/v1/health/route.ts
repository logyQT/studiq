import { NextResponse } from "next/server";
import { HealthController } from "@/server/controllers/health.controller";

/**
 * =============================================================================
 * HEALTH CHECK ENDPOINT
 * =============================================================================
 *
 * Endpoint: GET /api/v1/health
 * Opis: Zwraca status serwera i aktualny timestamp.
 *
 * Użycie:
 *   fetch('/api/v1/health')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 *
 * Response:
 *   {
 *     "status": "healthy",
 *     "timestamp": "2024-01-15T10:30:00.000Z",
 *     "uptime": 12345.678,
 *     "environment": "development"
 *   }
 *
 * Ten endpoint demonstruje wzorzec Controller w architekturze.
 * Logika biznesowa jest wydzielona do src/server/controllers/
 */
export async function GET() {
  const healthData = HealthController.getStatus();

  return NextResponse.json(healthData);
}
