'use client';

import { GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { LanguageSwitcher } from '@/components/shared/language-switcher/language-switcher';

/**
 * 44px tall on a phone, where a footer link measured 18px (#635's touch density
 * applies to the footer too); from md the pointer is a mouse, so the column keeps
 * the footer's compact rhythm and the `li` gap alone still governs the spacing.
 */
const FOOTER_LINK =
  'inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground transition md:min-h-6';

export function Footer() {
  const t = useTranslations('Footer');

  return (
    <footer className="border-t">
      {/* The rule is on the full-width `footer` above; only the gutter grows into
          the left/right safe-area insets, like `MainLayout`'s. */}
      <div className="mx-auto max-w-7xl py-12 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* BRAND */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <GraduationCap className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold tracking-tight">StudiQ</span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">{t('tagline')}</p>
          </div>

          {/* PRODUCT */}
          <div>
            <h3 className="text-sm font-semibold mb-3">{t('product')}</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/features" className={FOOTER_LINK}>
                  {t('features')}
                </Link>
              </li>
              <li>
                <Link href="/pricing" className={FOOTER_LINK}>
                  {t('pricing')}
                </Link>
              </li>
            </ul>
          </div>

          {/* COMPANY */}
          <div>
            <h3 className="text-sm font-semibold mb-3">{t('company')}</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/contact" className={FOOTER_LINK}>
                  {t('contact')}
                </Link>
              </li>
            </ul>
          </div>

          {/* LEGAL */}
          <div>
            <h3 className="text-sm font-semibold mb-3">{t('legal')}</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/privacy" className={FOOTER_LINK}>
                  {t('privacy')}
                </Link>
              </li>
              <li>
                <Link href="/terms" className={FOOTER_LINK}>
                  {t('terms')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{t('copyright')}</p>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </footer>
  );
}
