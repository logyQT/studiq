import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { locales } from "@/i18n/request";
import "@/app/globals.css";

/**
 * =============================================================================
 * FONTS CONFIGURATION
 * =============================================================================
 * Konfiguracja czcionek Google Fonts z optymalizacją Next.js.
 * Dodaj nowe czcionki importując je z 'next/font/google'.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
    default: "Next.js Boilerplate",
    template: "%s | Next.js Boilerplate",
  },
  description: "Professional Next.js 14+ boilerplate with TypeScript and Tailwind CSS",
  keywords: ["Next.js", "React", "TypeScript", "Tailwind CSS"],
  authors: [{ name: "Your Name" }],
  creator: "Your Name",
};

/**
 * =============================================================================
 * VIEWPORT
 * =============================================================================
 * Konfiguracja viewport dla responsywności i PWA.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

/**
 * =============================================================================
 * ROOT LAYOUT
 * =============================================================================
 * Główny layout aplikacji. Tutaj dodawaj:
 * - Providery kontekstu (ThemeProvider, AuthProvider, etc.)
 * - Globalne komponenty (Toaster, Analytics, etc.)
 * - Skrypty analityczne
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  // if (!locales.includes(locale)) notFound();

  const messages = await getMessages();

  return (
    <html lang={locale} className="bg-background" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <NextIntlClientProvider messages={messages}>
          {/*
            PROVIDERS - Dodaj tutaj swoje providery:
            <ThemeProvider>
            <AuthProvider>
            <QueryClientProvider>
          */}

          {children}

          {/*
            GLOBAL COMPONENTS - Dodaj tutaj globalne komponenty:
            <Toaster />
            <Analytics />
          */}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
