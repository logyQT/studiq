/**
 * =============================================================================
 * STRONA GŁÓWNA - BOILERPLATE
 * =============================================================================
 *
 * Ten plik to punkt wejścia Twojej aplikacji frontendowej.
 *
 * STRUKTURA PROJEKTU:
 * ├── src/
 * │   ├── app/                    # App Router (routing, strony, layouts)
 * │   │   ├── api/               # Route Handlers (REST API)
 * │   │   │   ├── route.ts       # GET /api/ - główny endpoint
 * │   │   │   └── v1/            # Wersjonowane API
 * │   │   │       └── health/    # GET /api/v1/health
 * │   │   ├── layout.tsx         # Root layout
 * │   │   ├── page.tsx           # Ta strona
 * │   │   └── globals.css        # Style globalne
 * │   │
 * │   ├── components/            # Komponenty React
 * │   │   ├── ui/               # Komponenty UI (shadcn/ui)
 * │   │   ├── forms/            # Komponenty formularzy
 * │   │   └── layout/           # Komponenty layoutu (Header, Footer, etc.)
 * │   │
 * │   ├── hooks/                 # Custom React Hooks
 * │   │   └── use-*.ts          # np. useAuth, useApi, useDebounce
 * │   │
 * │   ├── lib/                   # Biblioteki i utilities
 * │   │   ├── utils.ts          # Funkcje pomocnicze (cn, formatDate, etc.)
 * │   │   └── api-client.ts     # Klient do komunikacji z API
 * │   │
 * │   ├── server/                # Logika backendowa
 * │   │   ├── controllers/      # Kontrolery (obsługa requestów)
 * │   │   ├── services/         # Serwisy (logika biznesowa)
 * │   │   └── models/           # Modele danych / schematy
 * │   │
 * │   └── types/                 # Definicje TypeScript
 * │       └── index.ts          # Eksport typów
 *
 * =============================================================================
 * JAK DODAWAĆ KOMPONENTY:
 * =============================================================================
 *
 * 1. Utwórz komponent w odpowiednim folderze:
 *    - src/components/ui/       → dla prostych komponentów UI
 *    - src/components/layout/   → dla Header, Footer, Sidebar
 *    - src/components/forms/    → dla formularzy i inputów
 *
 * 2. Importuj komponent:
 *    import { Button } from "@/components/ui/button";
 *    import { Header } from "@/components/layout/header";
 *
 * 3. Użyj w JSX poniżej:
 *    <Header />
 *    <main>...</main>
 *    <Footer />
 *
 * =============================================================================
 * JAK KOMUNIKOWAĆ SIĘ Z API:
 * =============================================================================
 *
 * METODA 1: Fetch w Server Components (zalecane dla SSR)
 * -------------------------------------------------------
 * async function getData() {
 *   const res = await fetch('http://localhost:3000/api/v1/health');
 *   return res.json();
 * }
 *
 * export default async function Page() {
 *   const data = await getData();
 *   return <div>{data.status}</div>;
 * }
 *
 * METODA 2: SWR w Client Components (zalecane dla interaktywności)
 * -----------------------------------------------------------------
 * "use client";
 * import useSWR from "swr";
 *
 * const fetcher = (url: string) => fetch(url).then(res => res.json());
 *
 * function HealthStatus() {
 *   const { data, error, isLoading } = useSWR('/api/v1/health', fetcher);
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error</div>;
 *   return <div>Status: {data.status}</div>;
 * }
 *
 * METODA 3: Server Actions (dla mutacji)
 * ---------------------------------------
 * // W osobnym pliku: src/app/actions.ts
 * "use server";
 * export async function createItem(formData: FormData) {
 *   // logika serwera
 * }
 *
 * // W komponencie:
 * <form action={createItem}>...</form>
 *
 * =============================================================================
 * DOSTĘPNE ENDPOINTY API:
 * =============================================================================
 *
 * GET  /api/           → Sprawdzenie czy API działa
 * GET  /api/v1/health  → Status zdrowia serwera z timestampem
 *
 * Dodawaj nowe endpointy w: src/app/api/v1/[nazwa]/route.ts
 *
 * =============================================================================
 */

'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { useTranslations } from 'next-intl';

export default function Home() {
  const t = useTranslations('HomePage');

  return (
    <main className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-4xl font-bold mb-8">StudiQ</h1>
      <div className="flex gap-4">
        <Link href="/login">
          <Button variant="outline">{t('login_button')}</Button>
        </Link>
        <Link href="/register">
          <Button>{t('register_button')}</Button>
        </Link>
        <ThemeToggle></ThemeToggle>
        <LanguageToggle></LanguageToggle>
      </div>
    </main>
  );
}
