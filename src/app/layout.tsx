import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { getLocale, getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { Toaster } from 'sonner';
import { AuthProvider, ThemeProvider, QueryProvider } from '@/components/providers';
import '@/app/globals.css';
import { ToastProvider } from '@/components/ui/toast';

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
 * Konfiguracja SEO - dostosuj pod swój projekt.
 * Dokumentacja: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
 */
export const metadata: Metadata = {
  title: {
    default: 'Studiq',
    template: '%s | Studiq',
  },
  description: 'Professional Next.js 14+ boilerplate with TypeScript and Tailwind CSS',
  keywords: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS'],
  authors: [{ name: 'Your Name' }],
  creator: 'Your Name',
};

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

  return (
    <html lang={locale} className="bg-background" suppressHydrationWarning>
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
