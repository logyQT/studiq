import type { Config } from 'tailwindcss';

/**
 * =============================================================================
 * TAILWIND CSS CONFIGURATION
 * =============================================================================
 *
 * Dokumentacja: https://tailwindcss.com/docs/configuration
 *
 * ROZSZERZANIE KONFIGURACJI:
 * ==========================
 *
 * 1. Dodawanie kolorów:
 *    theme.extend.colors.brand = "#FF5733"
 *
 * 2. Dodawanie czcionek:
 *    theme.extend.fontFamily.heading = ["Poppins", "sans-serif"]
 *
 * 3. Dodawanie animacji:
 *    theme.extend.animation.fadeIn = "fadeIn 0.5s ease-in-out"
 *    theme.extend.keyframes.fadeIn = { from: { opacity: 0 }, to: { opacity: 1 } }
 */
const config: Config = {
  /**
   * Ścieżki do plików zawierających klasy Tailwind.
   * Dostosuj jeśli zmieniasz strukturę folderów.
   */
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],

  /**
   * Rozszerzenie domyślnego theme'u Tailwind.
   * Kolory są definiowane w globals.css jako zmienne CSS.
   */
  theme: {
    extend: {
      /**
       * Czcionki
       * Używaj: font-sans, font-mono
       */
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },

      /**
       * Dodatkowe animacje
       * Używaj: animate-fadeIn, animate-slideUp
       */
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },

  /**
   * Pluginy Tailwind
   * Dodaj tutaj dodatkowe pluginy np. @tailwindcss/typography
   */
  plugins: [],
};

export default config;
