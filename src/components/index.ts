/**
 * =============================================================================
 * COMPONENTS INDEX
 * =============================================================================
 *
 * Centralny punkt eksportu dla komponentów React.
 *
 * STRUKTURA KOMPONENTÓW:
 * ======================
 *
 * src/components/
 * ├── ui/                  # Podstawowe komponenty UI (shadcn/ui)
 * │   ├── button.tsx
 * │   ├── card.tsx
 * │   ├── input.tsx
 * │   └── ...
 * │
 * ├── layout/              # Komponenty layoutu
 * │   ├── header.tsx
 * │   ├── footer.tsx
 * │   ├── sidebar.tsx
 * │   └── navigation.tsx
 * │
 * ├── forms/               # Komponenty formularzy
 * │   ├── login-form.tsx
 * │   ├── register-form.tsx
 * │   └── contact-form.tsx
 * │
 * └── features/            # Komponenty domenowe
 *     ├── user-profile.tsx
 *     ├── product-card.tsx
 *     └── dashboard-widget.tsx
 */
export * from '@/components/layout';
export * from '@/components/providers';
