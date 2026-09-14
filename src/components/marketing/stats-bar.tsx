'use client';

import { useTranslations } from 'next-intl';

const stats = [
  { key: 'stats_questions', value: '10,000+' },
  { key: 'stats_flashcards', value: '50,000+' },
  { key: 'stats_students', value: '5,000+' },
  { key: 'stats_quizzes', value: '100,000+' },
] as const;

export function StatsBar() {
  const t = useTranslations('LandingPage');

  return (
    <section className="py-12 border-y bg-muted/20">
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map(({ key, value }) => (
            <div key={key} className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-primary">{value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{t(key)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
