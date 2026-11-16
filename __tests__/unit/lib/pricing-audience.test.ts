import { INDIVIDUAL_PRICING_URL, ORGANIZATION_PRICING_URL } from '@/lib/pricing-urls';
import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_HREF,
  audienceFromParam,
  type PricingAudience,
} from '@/app/(frontend)/pricing/_components/pricing-audience';

// `/pricing` serves both audiences, and the audience is the query string rather
// than component state: a shared link, the Back button and a stale parameter all
// land on the ladder the address names.

/** The query value a written address carries, read the way the page reads it. */
function audienceOfHref(href: string): PricingAudience {
  return audienceFromParam(new URL(href, 'http://localhost').searchParams.get('audience'));
}

describe('audienceFromParam', () => {
  it('reads the one value that changes the page as the organization audience', () => {
    expect(audienceFromParam('organization')).toBe('organization');
  });

  it('treats every other value as the default individual audience', () => {
    for (const value of [
      null,
      undefined,
      '',
      'individual',
      'Organization',
      'organization ',
      'org',
    ]) {
      expect(audienceFromParam(value), `audience value ${JSON.stringify(value)}`).toBe(
        'individual',
      );
    }
  });
});

describe('AUDIENCE_HREF', () => {
  it('addresses both audiences with the shared pricing URLs', () => {
    expect(AUDIENCE_HREF.individual).toBe(INDIVIDUAL_PRICING_URL);
    expect(AUDIENCE_HREF.organization).toBe(ORGANIZATION_PRICING_URL);
  });

  it('writes an address that reads back as the audience it names', () => {
    expect(audienceOfHref(AUDIENCE_HREF.individual)).toBe('individual');
    expect(audienceOfHref(AUDIENCE_HREF.organization)).toBe('organization');
  });
});
