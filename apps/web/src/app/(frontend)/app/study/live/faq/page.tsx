import { ArrowLeft, Key, Users, Zap } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function LiveFaqPage() {
  const t = await getTranslations('AppLiveStudyPage');

  const steps = [
    {
      icon: Key,
      title: t('step1_title'),
      desc: t('step1_desc'),
      number: '01',
    },
    {
      icon: Users,
      title: t('step2_title'),
      desc: t('step2_desc'),
      number: '02',
    },
    {
      icon: Zap,
      title: t('step3_title'),
      desc: t('step3_desc'),
      number: '03',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <Link
        href="/app/study/live"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="size-4" />
        {t('title')}
      </Link>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('faq_title')}</h1>
        <p className="text-muted-foreground">{t('faq_subtitle')}</p>
      </div>

      {steps.map(({ icon: Icon, title, desc, number }) => (
        <div key={title} className="border rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-4">
            <span className="text-3xl font-bold text-muted-foreground/20 select-none">
              {number}
            </span>
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5">
                  <Icon className="size-5 text-primary" />
                </div>
                <h2 className="text-lg font-semibold">{title}</h2>
              </div>
              <p className="text-muted-foreground leading-relaxed pl-1">{desc}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
