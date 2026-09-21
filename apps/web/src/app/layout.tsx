import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';

import '@/app/globals.css';
import { ToastProvider } from '@studiq/ui';

/**
 * =============================================================================
 * FONTS CONFIGURATION
 * =============================================================================
 */
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

/**
 * =============================================================================
 * METADATA
 * =============================================================================
 * Dokumentacja: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'LandingPage' });

  const title = { default: 'StudiQ', template: '%s | StudiQ' };
  const description = t('hero_subtitle');

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    keywords: ['fiszki', 'quizy', 'nauka', 'AI', 'studia', 'flashcards', 'quizzes', 'studying'],
    icons: {
      icon: [
        { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
        { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      ],
      apple: '/apple-icon.png',
    },
    openGraph: {
      type: 'website',
      locale,
      url: siteUrl,
      siteName: 'StudiQ',
      title: title.default,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: title.default,
      description,
    },
  };
}

/**
 * =============================================================================
 * VIEWPORT
 * =============================================================================
 * Konfiguracja viewport dla responsywności i PWA.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#181818' },
  ],
};

/**
 * =============================================================================
 * ROOT LAYOUT
 * =============================================================================
 */

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

  return (
    <html lang={locale} className="bg-background" suppressHydrationWarning>
      <head>
        {supabaseUrl && <link rel="preconnect" href={supabaseUrl} crossOrigin="anonymous" />}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider messages={messages}>
            <QueryProvider>
              <AuthProvider>
                <ToastProvider>{children}</ToastProvider>
                <Toaster
                  position="top-center"
                  richColors
                  duration={4000}
                  toastOptions={{
                    classNames: {
                      success: 'toast-success',
                      error: 'toast-error',
                      warning: 'toast-warning',
                      info: 'toast-info',
                    },
                  }}
                />
              </AuthProvider>
            </QueryProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
