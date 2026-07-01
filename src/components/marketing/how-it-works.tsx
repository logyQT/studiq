'use client';

import { BarChart3, FileText, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';

const steps = [
  { icon: FileText, titleKey: 'step1_title', descKey: 'step1_desc' },
  { icon: Target, titleKey: 'step2_title', descKey: 'step2_desc' },
  { icon: BarChart3, titleKey: 'step3_title', descKey: 'step3_desc' },
] as const;

const iconBg = [
  'bg-blue-500/10 text-blue-500',
  'bg-emerald-500/10 text-emerald-500',
  'bg-amber-500/10 text-amber-500',
];

export function HowItWorks() {
  const t = useTranslations('LandingPage');

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {t('how_it_works_title')}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">{t('how_it_works_desc')}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-8">
          {steps.map(({ icon: Icon, titleKey, descKey }, i) => (
            <div key={titleKey} className="text-center">
              <div
                className={`mx-auto size-14 rounded-2xl ${iconBg[i]} flex items-center justify-center mb-5`}
              >
                <Icon className="size-6" />
              </div>
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="text-sm font-bold text-muted-foreground/50">Step {i + 1}</span>
              </div>
              <h3 className="text-xl font-semibold mb-2">{t(titleKey)}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                {t(descKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
