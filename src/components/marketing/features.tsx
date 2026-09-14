'use client';

import { BarChart3, BookOpen, Brain, FileText, Sparkles, Target, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const freeFeatures = [
  { icon: FileText, titleKey: 'free_questions', descKey: 'free_questions_desc' },
  { icon: Brain, titleKey: 'free_flashcards', descKey: 'free_flashcards_desc' },
  { icon: BookOpen, titleKey: 'free_quizzes', descKey: 'free_quizzes_desc' },
  { icon: BarChart3, titleKey: 'free_stats', descKey: 'free_stats_desc' },
] as const;

const aiFeatures = [
  { icon: Sparkles, titleKey: 'ai_generate_questions', descKey: 'ai_generate_questions_desc' },
  { icon: Zap, titleKey: 'ai_generate_flashcards', descKey: 'ai_generate_flashcards_desc' },
  { icon: Target, titleKey: 'ai_exam_sim', descKey: 'ai_exam_sim_desc' },
] as const;

const iconColors = [
  'bg-blue-500/10 text-blue-500',
  'bg-purple-500/10 text-purple-500',
  'bg-emerald-500/10 text-emerald-500',
  'bg-amber-500/10 text-amber-500',
];

const aiIconColors = [
  'bg-violet-500/10 text-violet-500',
  'bg-orange-500/10 text-orange-500',
  'bg-rose-500/10 text-rose-500',
];

export function Features() {
  const t = useTranslations('LandingPage');

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">
            Free Forever
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('free_title')}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t('free_desc')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {freeFeatures.map(({ icon: Icon, titleKey, descKey }, i) => (
            <Card
              key={titleKey}
              className="border-border/50 group hover:border-primary/30 transition-colors"
            >
              <CardHeader>
                <div
                  className={`size-10 rounded-lg ${iconColors[i]} flex items-center justify-center mb-2 group-hover:scale-110 transition-transform`}
                >
                  <Icon className="size-5" />
                </div>
                <CardTitle className="text-lg">{t(titleKey)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t(descKey)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="mt-20 mx-auto max-w-5xl">
        <div className="text-center mb-12">
          <Badge className="mb-4">Premium & University</Badge>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('ai_title')}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t('ai_desc')}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          {aiFeatures.map(({ icon: Icon, titleKey, descKey }, i) => (
            <Card
              key={titleKey}
              className="border-border/50 group hover:border-primary/30 transition-colors"
            >
              <CardHeader>
                <div
                  className={`size-10 rounded-lg ${aiIconColors[i]} flex items-center justify-center mb-2 group-hover:scale-110 transition-transform`}
                >
                  <Icon className="size-5" />
                </div>
                <CardTitle className="text-lg">{t(titleKey)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t(descKey)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
