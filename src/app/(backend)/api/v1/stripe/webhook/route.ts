import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { stripeController } from '@/server/controllers/stripe.controller';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return toNextResponse(await stripeController.handleWebhook(body));
}
