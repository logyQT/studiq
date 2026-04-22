import { NextResponse } from "next/server";

/**
 * =============================================================================
 * API ROOT ENDPOINT
 * =============================================================================
 *
 * Endpoint: GET /api/
 * Opis: Prosty endpoint sprawdzający czy API działa.
 *
 * Użycie:
 *   fetch('/api/')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 *
 * Response:
 *   {
 *     "message": "API is running",
 *     "version": "1.0.0"
 *   }
 */
export async function GET() {
  return NextResponse.json({
    message: "API is running",
    version: "1.0.1",
  });
}
