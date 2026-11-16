'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MarketingShell } from '@/components/layout/MarketingShell';
import { GeneratedCardsPreview } from '@/components/marketing/previews/generated-cards-preview';
import { ProblemQuestionsPreview } from '@/components/marketing/previews/problem-questions-preview';
import { QuizReviewPreview } from '@/components/marketing/previews/quiz-review-preview';
import { SeatPoolsPreview } from '@/components/marketing/previews/seat-pools-preview';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { FOCUS_RING } from '@/components/shared/focus-ring';

interface Capability {
  title: string;
  desc: string;
}

interface ClusterData {
  id: string;
  ordinal: string;
  title: string;
  lede: string;
  items: readonly Capability[];
  /** Under the claim: the one action this cluster earns, when it earns one. */
  action?: React.ReactNode;
  /** After the ledger: the product surface that proves the claim. */
  surface?: React.ReactNode;
}

/**
 * The page's ordinal: a mono index in cobalt above the title, on the rail. It is
 * the same number the hero's index prints beside the link, so a reader who
 * arrived from the index can see which section they landed in.
 */
function ClusterRail({
  ordinal,
  title,
  lede,
  action,
}: Pick<ClusterData, 'ordinal' | 'title' | 'lede' | 'action'>) {
  return (
    <>
      <p aria-hidden="true" className="font-mono text-xl leading-none tabular-nums text-primary">
        {ordinal}
      </p>
      <h2 className="mt-3 font-display text-h2 font-semibold text-balance">{title}</h2>
      <p className="mt-4 max-w-[34ch] text-lede text-muted-foreground text-pretty">{lede}</p>
      {action}
    </>
  );
}

/**
 * A capability ledger: term in the left third of the row, what it gives you in
 * the right two thirds, one hairline per entry.
 *
 * The pair sits side by side from `md`, which is what makes the column scannable
 * as a spec sheet: the terms line up under each other and the eye drops down
 * them, instead of re-reading a stacked paragraph per row. The description keeps
 * `max-w-prose`, so the split never turns a one-line fact into a five-line wall.
 */
function Capabilities({ items }: { items: readonly Capability[] }) {
  return (
    <ul className="border-t border-border">
      {items.map(({ title, desc }) => (
        <li
          key={title}
          className="border-b border-border py-5 md:grid md:grid-cols-12 md:gap-x-8 md:py-6"
        >
          <h3 className="text-base font-semibold text-balance md:col-span-4">{title}</h3>
          <p className="mt-1.5 max-w-prose text-sm leading-snug text-muted-foreground text-pretty md:col-span-8 md:mt-0 md:leading-relaxed">
            {desc}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * A cluster: the claim on a four-column rail, its capabilities in the seven to
 * its right, and — where one exists — the product surface that proves it at the
 * end of the ledger.
 *
 * The rail sticks while its own ledger scrolls past, so the claim a row belongs
 * to is still on screen when the last row is read. That is the whole relation
 * between the two columns: the claim is the standing argument and the rows are
 * its evidence.
 *
 * Four clusters share one shape because they are the page's spine; the hero and
 * the closing block are the two places the page turns.
 */
function Cluster({ cluster }: { cluster: ClusterData }) {
  return (
    <section id={cluster.id} className="scroll-mt-header border-t border-border py-16 md:py-20">
      <div className="mx-auto max-w-content px-content lg:grid lg:grid-cols-12 lg:gap-x-8">
        <div className="lg:sticky lg:top-[calc(var(--header-height)+2.5rem)] lg:col-span-4 lg:self-start">
          <ClusterRail
            ordinal={cluster.ordinal}
            title={cluster.title}
            lede={cluster.lede}
            action={cluster.action}
          />
        </div>
        <div className="mt-8 lg:col-span-7 lg:col-start-6 lg:mt-0">
          <Capabilities items={cluster.items} />
          {cluster.surface ? <div className="mt-10 md:mt-12">{cluster.surface}</div> : null}
        </div>
      </div>
    </section>
  );
}

export default function FeaturesPage() {
  const t = useTranslations('FeaturesPage');

  /*
   * One worked example runs through the page's first three surfaces: they are the
   * same biology lecture — generated cards, a graded test, a class's failed
   * questions — so the page reads as the product applied to one course instead of
   * four unrelated demos. The fourth is an institution's seat pools, which belong
   * to the organization that owns the course.
   */
  const clusters: readonly ClusterData[] = [
    {
      id: 'study-loop',
      ordinal: '01',
      title: t('study_title'),
      lede: t('study_lede'),
      items: [
        { title: t('study_flashcards_title'), desc: t('study_flashcards_desc') },
        { title: t('study_tests_title'), desc: t('study_tests_desc') },
        { title: t('study_banks_title'), desc: t('study_banks_desc') },
        { title: t('study_stats_title'), desc: t('study_stats_desc') },
      ],
      surface: <QuizReviewPreview />,
    },
    {
      id: 'material',
      ordinal: '02',
      title: t('material_title'),
      lede: t('material_lede'),
      items: [
        { title: t('material_flashcards_title'), desc: t('material_flashcards_desc') },
        { title: t('material_questions_title'), desc: t('material_questions_desc') },
      ],
      surface: <GeneratedCardsPreview />,
    },
    {
      id: 'teaching',
      ordinal: '03',
      title: t('teaching_title'),
      lede: t('teaching_lede'),
      items: [
        { title: t('teaching_groups_title'), desc: t('teaching_groups_desc') },
        { title: t('teaching_roles_title'), desc: t('teaching_roles_desc') },
        { title: t('teaching_dashboard_title'), desc: t('teaching_dashboard_desc') },
      ],
      surface: <ProblemQuestionsPreview />,
    },
    {
      id: 'organization',
      ordinal: '04',
      title: t('org_title'),
      lede: t('org_lede'),
      items: [
        { title: t('org_structure_title'), desc: t('org_structure_desc') },
        { title: t('org_invites_title'), desc: t('org_invites_desc') },
        { title: t('org_analytics_title'), desc: t('org_analytics_desc') },
      ],
      surface: <SeatPoolsPreview />,
      action: (
        <p className="mt-6">
          <a
            href="/contact"
            className={`inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 ${FOCUS_RING}`}
          >
            {t('org_contact_link')}
          </a>
        </p>
      ),
    },
  ];

  return (
    <MarketingShell>
      {/*
       * The hero is an index, not a poster: the claim and the actions sit in the
       * seven-column rail, the page's four areas are the four-column rail beside
       * them, and the product opens underneath both. Someone who followed
       * „Funkcje” in the header is told what this page holds before being shown
       * any of it, which is the job the landing hero already does for the claim.
       */}
      <section className="pt-12 pb-16 md:pt-28 md:pb-20">
        <div className="mx-auto max-w-content px-content">
          <div className="lg:grid lg:grid-cols-12 lg:gap-x-8">
            <div className="lg:col-span-7">
              <p className="font-mono text-xs tracking-[0.08em] text-primary uppercase">
                {t('eyebrow')}
              </p>
              <h1 className="mt-4 font-display text-4xl font-semibold text-balance sm:text-5xl">
                {t('title')}
              </h1>
              <p className="mt-4 max-w-xl text-lede text-muted-foreground text-pretty md:mt-6">
                {t('subtitle')}
              </p>
              {/*
               * Below md the two actions stack and the column fills: side by side
               * at 390px they wrap to two ragged widths, which reads as a layout
               * accident rather than as one primary and one secondary.
               */}
              <div className="mt-8 flex flex-col items-stretch gap-3 md:mt-10 md:flex-row md:items-center">
                <CtaButton href="/register" tone="signal">
                  {t('cta_start')}
                </CtaButton>
                <CtaButton href="/pricing" tone="quiet">
                  {t('cta_pricing')}
                  <ArrowRight className="size-4" aria-hidden />
                </CtaButton>
              </div>
            </div>

            {/*
             * The contents. Every entry is an in-page anchor with the same
             * ordinal and the same name its section carries, so the hero answers
             * „what is on this page” and „where do I start” in one element.
             */}
            <nav
              aria-label={t('index_aria')}
              className="mt-12 lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:mt-0"
            >
              <p className="font-mono text-xs tracking-[0.08em] text-primary uppercase">
                {t('index_label')}
              </p>
              <ol className="mt-4 border-t border-border">
                {clusters.map((cluster) => (
                  <li key={cluster.id} className="border-b border-border">
                    <a
                      href={`#${cluster.id}`}
                      className={`group flex min-h-11 items-center gap-4 py-3 ${FOCUS_RING}`}
                    >
                      <span
                        aria-hidden="true"
                        className="font-mono text-xs tabular-nums text-primary"
                      >
                        {cluster.ordinal}
                      </span>
                      <span className="flex-1 text-sm font-medium group-hover:underline group-hover:underline-offset-4">
                        {cluster.title}
                      </span>
                      <span
                        aria-hidden="true"
                        className="font-mono text-xs tabular-nums text-muted-foreground"
                      >
                        {t('index_count', { count: cluster.items.length })}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>

          {/*
           * The product opens under the hero, in the first cluster, rather than
           * beside the claim: a graded question belongs to the study loop, and a
           * score card on its own would have said nothing this page does not.
           */}
        </div>
      </section>

      {clusters.map((cluster) => (
        <Cluster key={cluster.id} cluster={cluster} />
      ))}

      {/*
       * The page ends on a decision, not a cheer: one action, and one ruled line
       * to the page that answers what it costs. Prices and limits live on
       * /pricing only, so no tier vocabulary is reprinted here.
       */}
      <section className="bg-muted">
        <div className="mx-auto max-w-content px-content py-16 md:grid md:grid-cols-12 md:gap-x-8 md:py-20">
          <div className="md:col-span-7">
            <h2 className="font-display text-h2 font-semibold text-balance">
              {t('closing_title')}
            </h2>
            <p className="mt-4 max-w-xl text-lede text-muted-foreground text-pretty">
              {t('closing_lede')}
            </p>
          </div>
          <div className="mt-8 md:col-span-5 md:col-start-8 md:mt-0">
            <CtaButton href="/register" tone="signal" fullWidth>
              {t('cta_start')}
            </CtaButton>
            <ul className="mt-6 border-t border-border">
              <li className="border-b border-border">
                <a
                  href="/pricing"
                  className={`flex min-h-11 items-center justify-between gap-4 py-3 text-sm font-semibold text-primary ${FOCUS_RING}`}
                >
                  {t('closing_pricing_link')}
                  <ArrowRight className="size-4 shrink-0" aria-hidden />
                </a>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
