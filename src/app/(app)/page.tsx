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
 */

/**
 * @Tonderysik
 * TODO: Replace current HomePage with proper marketing landing page
 * TODO: Add Hero section (value proposition + primary CTA e.g. "Zacznij naukę")
 * TODO: Add Features section (Testy ABCD, Fiszki, Egzamin AI, Statystyki + krótkie opisy)
 * TODO: Add Pricing section (free vs premium)
 * TODO: Add Footer with basic links (Kontakt, Privacy Policy, Terms)
 * TODO: Ensure responsive layout (mobile-first)
 * TODO: Keep consistency with design system (shadcn/ui)
 * TODO: Avoid layout shift / hydration issues
 */

'use client';

export default function HomePage() {
  return (
    <section className="flex w-full flex-col items-center justify-center py-12">
      <h1 className="text-4xl font-bold">Witaj w StudiQ</h1>
      <p className="mt-4 text-lg text-muted-foreground">Twoja platforma do efektywnej nauki.</p>
    </section>
  );
}
