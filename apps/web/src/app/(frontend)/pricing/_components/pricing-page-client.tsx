'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  AudienceSwitch,
  type PricingAudience,
} from '@/app/(frontend)/pricing/_components/audience-switch';
import {
  ComparisonTable,
  type PricingLadderKind,
} from '@/app/(frontend)/pricing/_components/comparison-table';
import { PlanRow } from '@/app/(frontend)/pricing/_components/plan-row';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';
import { getPlanLadders } from '@/lib/pricing-ladders';

/** The region the audience radios swap; the switch's `aria-controls` points here. */
const PLANS_REGION_ID = 'pricing-plans';

/** The audience lives in the URL so a shared link opens on the ladder it named. */
const AUDIENCE_URL: Record<PricingAudience, string> = {
  individual: '/pricing',
  organization: '/pricing?audience=organization',
};

export function PricingPageClient({ initialAudience }: { initialAudience: PricingAudience }) {
  const t = useTranslations('PricingPage');
  const router = useRouter();
  const [audience, setAudience] = useState(initialAudience);
  const { user } = useAuth();
  const { activeOrg } = useOrgs();

  // One request: the catalogue is a flat list and `sort_order` spans all three
  // ladders, so the page splits it rather than asking per audience.
  const { data: plans, isLoading } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active'],
    url: '/api/v1/subscription-plans',
  });

  // Managers are the org's billing contact: their current plan is the active
  // organization's plan, the same `/me/plan` query `/manage/billing` uses (#228).
  // Students/educators keep reading their own personal plan (#181).
  // `app_metadata` is an untyped Supabase map; `account_type` must be narrowed.
  const rawAccountType: unknown = user?.app_metadata.account_type;
  const isManager = rawAccountType === 'manager';
  const { data: currentPlan } = useApiQuery<PlanInfo>({
    queryKey: ['me', isManager ? 'plan' : 'personal-plan'],
    url: isManager ? '/api/v1/me/plan' : '/api/v1/me/personal-plan',
    enabled: !!user,
  });

  const ladders = getPlanLadders(plans ?? []);
  const organization = audience === 'organization';

  const sections: Array<{
    kind: PricingLadderKind;
    title: string;
    lede: string;
    plans: PlanInfo[];
  }> = organization
    ? [
        {
          kind: 'organization',
          title: t('ladder_org_title'),
          lede: t('ladder_org_lede'),
          plans: ladders.organization,
        },
      ]
    : [
        {
          kind: 'student',
          title: t('ladder_student_title'),
          lede: t('ladder_student_lede'),
          plans: ladders.individual.student,
        },
        {
          kind: 'educator',
          title: t('ladder_educator_title'),
          lede: t('ladder_educator_lede'),
          plans: ladders.individual.educator,
        },
      ];

  function selectAudience(next: PricingAudience) {
    if (next === audience) return;
    // State first: the ladder swaps on the click, and the URL follows without
    // scrolling the reader back to the top of the page.
    setAudience(next);
    router.replace(AUDIENCE_URL[next], { scroll: false });
  }

  return (
    <>
      <section className="border-b border-primary pt-12 pb-12 md:pt-28 md:pb-20">
        <div className="mx-auto grid max-w-content gap-y-8 px-content lg:grid-cols-12 lg:gap-x-8 lg:gap-y-0">
          <div className="lg:col-span-7">
            <p className="font-mono text-xs tracking-[0.08em] text-primary uppercase">
              {t('eyebrow')}
            </p>
            <h1 className="mt-3 font-display text-display font-semibold text-balance">
              {t('title')}
            </h1>
            <p className="mt-4 max-w-xl text-lede text-muted-foreground text-pretty md:mt-6">
              {t('subtitle')}
            </p>
          </div>
          {/* Bottom-aligned against the lede: the control is the hero's action, not its headline. */}
          <div className="lg:col-span-4 lg:col-start-9 lg:self-end">
            <AudienceSwitch value={audience} onChange={selectAudience} controls={PLANS_REGION_ID} />
          </div>
        </div>
      </section>

      <div id={PLANS_REGION_ID}>
        {isLoading ? (
          <div className="mx-auto flex max-w-content justify-center px-content py-16 md:py-20">
            <Loader2 aria-hidden className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          sections.map((section) =>
            section.plans.length > 0 ? (
              <section key={section.kind} className="py-16 md:py-20">
                <div className="mx-auto max-w-content px-content">
                  <h2 className="font-display text-h2 font-semibold text-balance">
                    {section.title}
                  </h2>
                  <p className="mt-3 max-w-xl text-sm text-muted-foreground">{section.lede}</p>
                  <ul className="mt-8 border-t border-border">
                    {section.plans.map((plan) => (
                      <PlanRow
                        key={plan.key}
                        plan={plan}
                        isCurrent={currentPlan?.key === plan.key}
                        signedIn={!!user}
                        orgId={activeOrg?.id}
                      />
                    ))}
                  </ul>
                  <ComparisonTable plans={section.plans} kind={section.kind} />
                </div>
              </section>
            ) : null,
          )
        )}
      </div>

      <section className="border-t border-border py-16 md:py-20">
        <div className="mx-auto flex max-w-content flex-col gap-6 px-content md:flex-row md:items-end md:justify-between md:gap-16">
          <h2 className="max-w-xl font-display text-h2 font-semibold text-balance">
            {organization ? t('close_org_line') : t('close_individual_line')}
          </h2>
          <CtaButton href={organization ? '/contact' : '/register'} tone="signal">
            {organization ? t('close_org_cta') : t('cta_free')}
          </CtaButton>
        </div>
      </section>
    </>
  );
}
