'use client';

import { Quote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';

const testimonials = [
  {
    quoteKey: 'testimonial_1_quote',
    authorKey: 'testimonial_1_author',
    roleKey: 'testimonial_1_role',
  },
  {
    quoteKey: 'testimonial_2_quote',
    authorKey: 'testimonial_2_author',
    roleKey: 'testimonial_2_role',
  },
] as const;

export function Testimonials() {
  const t = useTranslations('LandingPage');

  return (
    <section className="py-16 sm:py-24 bg-muted/30">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {t('testimonials_title')}
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-8">
          {testimonials.map(({ quoteKey, authorKey, roleKey }) => (
            <Card key={quoteKey} className="border-border/50">
              <CardContent className="pt-6">
                <Quote className="size-8 text-primary/30 mb-4" />
                <p className="text-base leading-relaxed text-foreground/90 mb-6">
                  &ldquo;{t(quoteKey)}&rdquo;
                </p>
                <div>
                  <div className="font-semibold text-sm">{t(authorKey)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t(roleKey)}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
