import { INDIVIDUAL_PRICING_URL, ORGANIZATION_PRICING_URL } from '@/lib/pricing-urls';

/**
 * Which pair of ladders the page is showing. It lives in the URL and nowhere
 * else: a shared link, the Back button and the navbar's "Cennik" link all reach
 * the ladder they name because all three change the address, not a local copy.
 */
export type PricingAudience = 'individual' | 'organization';

/**
 * The written address of each audience. Individual is the bare route, so the
 * default view never carries a parameter that says nothing.
 */
export const AUDIENCE_HREF: Record<PricingAudience, string> = {
  individual: INDIVIDUAL_PRICING_URL,
  organization: ORGANIZATION_PRICING_URL,
};

/**
 * The audience a query value names. Only the one value that changes the page is
 * read as itself, so a hand-edited or stale parameter cannot open an empty
 * ladder; it lands on the default instead.
 */
export function audienceFromParam(value: string | null | undefined): PricingAudience {
  return value === 'organization' ? 'organization' : 'individual';
}
