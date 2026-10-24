import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    // Next.js buffers the request body whenever the proxy runs, capped at 10 MB
    // by default — that truncated 25 MB multipart uploads before the route saw
    // them (#185). Must stay >= MAX_REQUEST_BYTES in
    // packages/server/src/services/storage.service.ts (50 MB file + 1 MB
    // multipart overhead); the route still rejects anything larger with a 413.
    proxyClientMaxBodySize: 64 * 1024 * 1024,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/auth/callback',
        destination: '/api/v1/auth/callback',
      },
    ];
  },
};

export default withNextIntl(nextConfig);
