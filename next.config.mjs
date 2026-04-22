import createNextIntlPlugin from "next-intl/plugin";

// Wskazujemy ścieżkę do pliku, który stworzyliśmy przed chwilą
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
};

export default withNextIntl(nextConfig);
