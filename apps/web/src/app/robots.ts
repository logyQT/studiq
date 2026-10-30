import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@studiq/server/lib/site-url';

const siteUrl = getSiteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/app/', '/edu/', '/manage/', '/billing', '/checkout', '/setup/', '/api/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
