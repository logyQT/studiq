import { questionController } from '@studiq/server/controllers/question.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * The exposure ledger of one item (#1172, R8): who already saw its key, when, and in which classes.
 * Staff with the key permission only; the service refuses everyone else and the payload never
 * carries key material.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(req, async (ctx) => toNextResponse(await questionController.ledger(id, ctx)));
}
