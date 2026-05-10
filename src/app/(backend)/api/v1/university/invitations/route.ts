/**
 * @swagger
 * /api/v1/university/invitations:
 *   post:
 *     summary: Wyślij zaproszenie do uczelni
 *     description: Generuje token zaproszenia dla studenta lub wykładowcy i wysyła e-mail. Wymaga uprawnień university_admin.
 *     tags:
 *       - University
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateInviteRequest'
 *     responses:
 *       201:
 *         description: Zaproszenie wysłane pomyślnie
 *       400:
 *         description: Błąd walidacji (np. błędny adres email lub rola)
 *       401:
 *         description: Nieautoryzowany dostęp (brak sesji)
 *       403:
 *         description: Brak uprawnień administratora uczelni
 *       500:
 *         description: Wewnętrzny błąd serwera
 */

import { NextRequest } from 'next/server';
import { invitationController } from '@/server/controllers/invitation.controller';

export async function POST(req: NextRequest) {
  return invitationController.create(req);
}

export async function GET(req: NextRequest) {
  return invitationController.getByToken(req);
}
