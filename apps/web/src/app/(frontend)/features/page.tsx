'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MarketingShell } from '@/components/layout/MarketingShell';
import { QuizQuestionPreview } from '@/components/marketing/previews/quiz-question-preview';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { SectionHeader } from '@/components/marketing/ui/section-header';
import { FOCUS_RING } from '@/components/shared/focus-ring';

interface Capability {
  title: string;
  desc: string;
}

/**
 * One capability per hairline row, term above its description.
 *
 * The rows are stacked rather than a two-column split because each cluster
 * already gives its header a four-column rail: a split *inside* the remaining
 * seven would put the description in a third of the page and wrap it to five
 * lines. Term over description keeps the scannable list and reads at 320 px
 * exactly as it does at 1440.
 *
 * A card grid was this page's defect (ten peers, no argument), so the list is
 * ruled and the claim lives in the section header.
 */
function Capabilities({ items }: { items: readonly Capability[] }) {
  return (
    <ul className="mt-8 border-t border-border md:mt-0">
      {items.map(({ title, desc }) => (
        <li key={title} className="border-b border-border py-5 md:py-6">
          <h3 className="text-h3 font-semibold text-balance">{title}</h3>
          <p className="mt-1.5 max-w-prose text-sm leading-snug text-muted-foreground md:leading-relaxed">
            {desc}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * A cluster: the claim on the four-column rail, its capabilities on the seven to
 * its right. Four of these are the page's spine, which is why they share one
 * shape instead of four arrangements; the hero and the closing block are the two
 * places the page turns.
 */
function Cluster({
  id,
  eyebrow,
  title,
  lede,
  items,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede: string;
  items: readonly Capability[];
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-header border-t border-border py-16 md:py-20">
      <div className="mx-auto max-w-content px-content lg:grid lg:grid-cols-12 lg:gap-x-8">
        <div className="lg:col-span-4">
          <SectionHeader eyebrow={eyebrow} title={title} lede={lede} />
          {children}
        </div>
        <div className="lg:col-span-7 lg:col-start-6">
          <Capabilities items={items} />
        </div>
      </div>
    </section>
  );
}

export default function FeaturesPage() {
  const t = useTranslations('FeaturesPage');

  const study = [
    { title: t('study_flashcards_title'), desc: t('study_flashcards_desc') },
    { title: t('study_tests_title'), desc: t('study_tests_desc') },
    { title: t('study_banks_title'), desc: t('study_banks_desc') },
    { title: t('study_stats_title'), desc: t('study_stats_desc') },
  ];

  const material = [
    { title: t('material_flashcards_title'), desc: t('material_flashcards_desc') },
    { title: t('material_questions_title'), desc: t('material_questions_desc') },
  ];

  const teaching = [
    { title: t('teaching_groups_title'), desc: t('teaching_groups_desc') },
    { title: t('teaching_roles_title'), desc: t('teaching_roles_desc') },
    { title: t('teaching_dashboard_title'), desc: t('teaching_dashboard_desc') },
  ];

  const organization = [
    { title: t('org_structure_title'), desc: t('org_structure_desc') },
    { title: t('org_invites_title'), desc: t('org_invites_desc') },
    { title: t('org_analytics_title'), desc: t('org_analytics_desc') },
  ];

  return (
    <MarketingShell>
      {/*
       * Copy on the seven-column rail, product on the five-column one, the split
       * the landing hero uses. The quiz card is the page's dominant surface and
       * the only one above the fold: it is the real component, so the first thing
       * a visitor can do here is answer a question and finish on a graded score.
       */}
      <section className="pt-12 pb-12 md:pt-28 md:pb-20">
        <div className="mx-auto grid max-w-content gap-y-8 px-content lg:grid-cols-12 lg:gap-x-8 lg:gap-y-0">
          <div className="lg:col-span-7">
            <h1 className="font-display text-display font-semibold text-balance">{t('title')}</h1>
            <p className="mt-4 max-w-xl text-lede text-muted-foreground text-pretty md:mt-6">
              {t('subtitle')}
            </p>
            <div className="mt-8 flex flex-col gap-3 md:mt-10 md:flex-row md:flex-wrap md:items-center">
              <CtaButton href="/register" tone="signal">
                {t('cta_start')}
              </CtaButton>
              <CtaButton href="/pricing" tone="quiet">
                {t('cta_pricing')}
                <ArrowRight className="size-4" aria-hidden />
              </CtaButton>
            </div>
          </div>
          <div className="lg:col-span-5 lg:col-start-8 lg:border-l-2 lg:border-primary lg:pt-4 lg:pl-8">
            <QuizQuestionPreview />
          </div>
        </div>
      </section>

      <Cluster
        id="study-loop"
        eyebrow={t('study_eyebrow')}
        title={t('study_title')}
        lede={t('study_lede')}
        items={study}
      />

      <Cluster
        id="material"
        eyebrow={t('material_eyebrow')}
        title={t('material_title')}
        lede={t('material_lede')}
        items={material}
      />

      <Cluster
        id="teaching"
        eyebrow={t('teaching_eyebrow')}
        title={t('teaching_title')}
        lede={t('teaching_lede')}
        items={teaching}
      />

      <Cluster
        id="organization"
        eyebrow={t('org_eyebrow')}
        title={t('org_title')}
        lede={t('org_lede')}
        items={organization}
      >
        <p className="mt-6">
          <a
            href="/contact"
            className={`inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 ${FOCUS_RING}`}
          >
            {t('org_contact_link')}
          </a>
        </p>
      </Cluster>

      {/*
       * The page ends on a decision, not a cheer: the action it has earned is a
       * free account, and the two questions left (what it costs, how to roll it
       * out) each have an address. Prices and limits live on /pricing only, so no
       * tier vocabulary is reprinted here.
       */}
      <section className="border-t border-primary py-16 md:py-20">
        <div className="mx-auto max-w-content px-content md:grid md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-7">
            <h2 className="font-display text-h2 font-semibold text-balance">
              {t('closing_title')}
            </h2>
            <p className="mt-4 max-w-xl text-lede text-muted-foreground text-pretty">
              {t('closing_lede')}
            </p>
          </div>
          <div className="mt-8 md:col-span-5 md:col-start-8 md:mt-0">
            <CtaButton href="/register" tone="signal">
              {t('cta_start')}
            </CtaButton>
            <p className="mt-4">
              <a
                href="/pricing"
                className={`inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 ${FOCUS_RING}`}
              >
                {t('closing_pricing_link')}
              </a>
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
