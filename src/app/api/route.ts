import { NextResponse } from "next/server";

/**
 * @swagger
 * /api:
 *   get:
 *     summary: Sprawdzenie stanu API
 *     description: Endpoint zwracający informację o wersji i statusie API.
 *     responses:
 *       200:
 *         description: API działa poprawnie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: API is running
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 */
export async function GET() {
  return NextResponse.json({
    message: "API is running",
    version: "1.0.0",
  });
}
