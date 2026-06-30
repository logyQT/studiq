import { NextRequest } from 'next/server';
import { stripeController } from '@/server/controllers/stripe.controller';
import { toNextResponse } from '@/lib/http-utils';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return toNextResponse(await stripeController.handleWebhook(body));
}
