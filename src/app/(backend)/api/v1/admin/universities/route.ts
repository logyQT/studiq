/**
 * @swagger
 * /api/v1/admin/universities:
 *   post:
 *     summary: Utwórz nową uczelnię
 *     description: Tworzy nową strukturę uniwersytetu w systemie. Wymaga uprawnień sys_admin.
 *     tags:
 *       - Admin
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUniversityRequest'
 *     responses:
 *       201:
 *         description: Uczelnia utworzona pomyślnie
 *       400:
 *         description: Błąd walidacji danych wejściowych
 *       401:
 *         description: Nieautoryzowany dostęp (brak sesji)
 *       403:
 *         description: Brak uprawnień (tylko sys_admin)
 *       409:
 *         description: Podany slug uniwersytetu jest już zajęty
 *       500:
 *         description: Wewnętrzny błąd serwera
 */

import { NextRequest } from 'next/server';
import { universityController } from '@/server/controllers/university.controller';
import { toNextResponse } from '@/lib/http-utils';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const response = await universityController.create(body);
  return toNextResponse(response);
}
