'use client';

import { useTranslations } from 'next-intl';

export default function TermsPage() {
  const t = useTranslations('TermsPage');

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-4xl font-bold mb-8">{t('title')}</h1>

      <div className="prose prose-sm max-w-none text-muted-foreground space-y-8">
        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('general_title')}</h2>
          <p>{t('general_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('accounts_title')}</h2>
          <p>{t('accounts_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('services_title')}</h2>
          <p>{t('services_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('content_title')}</h2>
          <p>{t('content_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('payments_title')}</h2>
          <p>{t('payments_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('liability_title')}</h2>
          <p>{t('liability_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('cookies_title')}</h2>
          <p>{t('cookies_text')}</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>{t('cookies_item1')}</li>
            <li>{t('cookies_item2')}</li>
            <li>{t('cookies_item3')}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('changes_title')}</h2>
          <p>{t('changes_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('contact_title')}</h2>
          <p>{t('contact_text')}</p>
        </section>
      </div>
    </div>
  );
}
