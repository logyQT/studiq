'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GraduationCap } from 'lucide-react';
import { LanguageToggle } from './LanguageToggle';

export function Footer() {
  const t = useTranslations('Footer');

  return (
    <footer className="border-t bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
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
                <Link
                  href="/features"
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
                  {t('features')}
                </Link>
              </li>
              <li>
                <Link
                  href="/pricing"
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
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
                <Link
                  href="/contact"
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
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
                <Link
                  href="/privacy"
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
                  {t('privacy')}
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
                  {t('terms')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{t('copyright')}</p>
          <LanguageToggle />
        </div>
      </div>
    </footer>
  );
}
