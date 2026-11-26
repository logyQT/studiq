import { billingController } from '@studiq/server/controllers/billing.controller';
import { createRateLimiter } from '@studiq/server/lib/rate-limiter';
import { authedRoute } from '@studiq/server/lib/route-handler';

/**
 * The preview reads Stripe's upcoming invoice for the proposed change. It
 * writes nothing, but it still spends a provider read per click; same
 * per-process burst guard as the other billing actions.
 */
const rateLimiter = createRateLimiter(60_000, 20);

/**
 * Read-only preview for the confirmation dialog: owner, customer, subscription
 * and price are resolved server-side, and the body carries the target plan key
 * plus the optional `scope` literal.
 */
export const POST = authedRoute(
  ({ json }) => [json],
  (ctx, body) => billingController.previewChange(ctx, body),
  { readsBody: true, rateLimit: rateLimiter },
);
