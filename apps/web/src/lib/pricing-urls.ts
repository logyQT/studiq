/**
 * Both audiences are rendered by `/pricing`; the audience lives in the query so a
 * link a manager shares opens the organization ladder instead of the personal one.
 * There is no per-audience route to link to.
 */
export const INDIVIDUAL_PRICING_URL = '/pricing';
export const ORGANIZATION_PRICING_URL = '/pricing?audience=organization';
