import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@studiq/server/lib/site-url';

const siteUrl = getSiteUrl();

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    '',
    '/pricing',
    '/pricing/student',
    '/pricing/edu',
    '/pricing/org',
    '/features',
    '/contact',
    '/privacy',
    '/terms',
    '/login',
    '/register',
  ];

  return staticRoutes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : route.startsWith('/pricing') ? 0.8 : 0.5,
  }));
}
