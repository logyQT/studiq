'use client';

import { useTranslations } from 'next-intl';

export default function PrivacyPage() {
  const t = useTranslations('PrivacyPage');

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-4xl font-bold mb-8">{t('title')}</h1>

      <div className="prose prose-sm max-w-none text-muted-foreground space-y-8">
        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('controller_title')}</h2>
          <p>{t('controller_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('data_title')}</h2>
          <p>{t('data_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('purpose_title')}</h2>
          <p>{t('purpose_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('legal_title')}</h2>
          <p>{t('legal_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('rights_title')}</h2>
          <p>{t('rights_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('retention_title')}</h2>
          <p>{t('retention_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('cookies_title')}</h2>
          <p>{t('cookies_text')}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">{t('contact_title')}</h2>
          <p>{t('contact_text')}</p>
        </section>
      </div>
    </div>
  );
}
