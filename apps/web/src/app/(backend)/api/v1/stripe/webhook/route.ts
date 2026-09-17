import { stripeController } from '@studiq/server/controllers/stripe.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return toNextResponse(await stripeController.handleWebhook(body));
}
