'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { ArrowRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AudienceSwitch } from '@/app/(frontend)/pricing/_components/audience-switch';
import {
  ComparisonTable,
  type PricingLadderKind,
} from '@/app/(frontend)/pricing/_components/comparison-table';
import { PlanRow } from '@/app/(frontend)/pricing/_components/plan-row';
import {
  AUDIENCE_HREF,
  audienceFromParam,
  type PricingAudience,
} from '@/app/(frontend)/pricing/_components/pricing-audience';
import { PricingFaq } from '@/app/(frontend)/pricing/_components/pricing-faq';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { useAuth } from '@/components/providers/AuthProvider';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';
import { getPlanLadders } from '@/lib/pricing-ladders';
import { cn } from '@/lib/utils';

/** The region the audience radios swap; the switch's `aria-controls` points here. */
const PLANS_REGION_ID = 'pricing-plans';

interface PricingPageClientProps {
  /**
   * The catalogue as the server read it. Present on a left one; `undefined` when
   * that read failed, so the page falls back to the client query alone.
   */
  initialPlans?: PlanInfo[];
}

export function PricingPageClient({ initialPlans }: PricingPageClientProps) {
  const t = useTranslations('PricingPage');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { activeOrg } = useOrgs();

  /*
   * The URL is the audience. A local copy would keep rendering the ladder the
   * reader left while the address said something else: Back from
   * `?audience=organization` and the navbar's "Cennik" link both change the
   * address without clicking the switch.
   */
  const audience = audienceFromParam(searchParams.get('audience'));
  const organization = audience === 'organization';

  // One request: the catalogue is a flat list and `sort_order` spans both
  // ladders, so the page splits it rather than asking per audience.
  const catalogue = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active'],
    url: '/api/v1/subscription-plans',
  });

  /*
   * The server read is the first paint: keep printing its rows while this query
   * resolves, and do not let a client failure erase prices the response already
   * carried. Only a page with no catalogue at all shows the error line.
   */
  const plans = catalogue.data ?? initialPlans;
  const catalogueUnavailable = catalogue.isError && !plans;
  const isLoading = !plans && !catalogueUnavailable;

  /*
   * The badge follows the ladder on screen. The individual ladder has one plan
   * for every persona, so it always reads the reader's own plan; the
   * organization ladder badges a manager from `/me/plan`, the same query
   * `/manage/billing` uses (#228). The key names the endpoint, so the two
   * answers cannot share a cache entry.
   * `app_metadata` is an untyped Supabase map; `account_type` must be narrowed.
   */
  const rawAccountType: unknown = user?.app_metadata.account_type;
  const accountType = typeof rawAccountType === 'string' ? rawAccountType : null;
  const isManager = accountType === 'manager';
  const currentPlanKey = organization && isManager ? 'plan' : 'personal-plan';
  const { data: currentPlan, isSuccess: planLoaded } = useApiQuery<PlanInfo>({
    queryKey: ['me', currentPlanKey],
    url: `/api/v1/me/${currentPlanKey}`,
    enabled: !!user,
  });

  /*
   * A paid plan in hand means a second checkout would be refused (one active
   * subscription per owner); the row sends that reader to the billing page,
   * which owns the plan change. A free plan — including the organization
   * ladder's `launch` — is not a subscription the reader changes.
   *
   * `null` until the plan read succeeds: a pending or failed read must not
   * turn a subscriber into a checkout, so the row prints no action rather than
   * guessing. The badge and prices still render.
   */
  const hasActivePlan: boolean | null = planLoaded ? currentPlan.priceMonthly > 0 : null;

  /*
   * The destination follows the plan the reader owns, not the ladder on screen:
   * an organization plan is changed on the org dashboard, a personal plan on the
   * reader's own billing page. The plan's scope is the authority; the ladder the
   * reader opened must not redirect an org plan to a personal surface, or a
   * personal plan to the org dashboard (#1493 follow-up).
   */
  const personalBillingHref = accountType === 'educator' ? '/edu/billing' : '/app/billing';
  const billingHref =
    currentPlan?.scope === 'organization' ? '/manage/billing' : personalBillingHref;

  const ladders = getPlanLadders(plans ?? []);

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
          kind: 'individual',
          title: t('ladder_individual_title'),
          lede: t('ladder_individual_lede'),
          plans: ladders.individual,
        },
      ];

  function selectAudience(next: PricingAudience) {
    /*
     * `push`, not `replace`: the address is the audience, so Back has to undo the
     * switch and return the ladder the reader left. `scroll: false` keeps the
     * reader at the switch rather than throwing them back to the hero.
     */
    router.push(AUDIENCE_HREF[next], { scroll: false });
  }

  return (
    <>
      <section className="border-b border-primary pt-12 pb-12 md:pt-28 md:pb-20">
        <div className="mx-auto grid max-w-content gap-y-8 px-content lg:grid-cols-12 lg:gap-x-8 lg:gap-y-0">
          <div className="lg:col-span-7">
            <h1 className="font-display text-display font-semibold text-balance">{t('title')}</h1>
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
        {catalogueUnavailable ? (
          // A failed catalogue has no prices to print, and inventing one is worse
          // than saying so. One line replaces the ladders; the action is real.
          <section className="py-16 md:py-20">
            <div className="mx-auto max-w-content px-content">
              <p className="max-w-xl text-sm text-muted-foreground">
                {t('catalogue_unavailable')}{' '}
                <Link
                  href="/contact"
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-control font-semibold text-primary underline-offset-4 hover:underline',
                    FOCUS_RING,
                  )}
                >
                  {t('cta_contact')}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </p>
            </div>
          </section>
        ) : (
          sections.map((section) => (
            <section key={section.kind} className="py-16 md:py-20">
              <div className="mx-auto max-w-content px-content">
                <h2 className="font-display text-h2 font-semibold text-balance">{section.title}</h2>
                <p className="mt-3 max-w-xl text-sm text-muted-foreground">{section.lede}</p>

                {isLoading ? (
                  // The ladder is named before its prices arrive, so the reader
                  // knows which list is loading rather than facing a bare hero.
                  <div className="mt-8 flex border-t border-border pt-8">
                    <Loader2 aria-hidden className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <ul className="mt-8 border-t border-border">
                      {section.plans.map((plan) => (
                        <PlanRow
                          key={plan.key}
                          plan={plan}
                          isCurrent={currentPlan?.key === plan.key}
                          signedIn={!!user}
                          hasActivePlan={hasActivePlan}
                          billingHref={billingHref}
                          orgId={activeOrg?.id}
                        />
                      ))}
                    </ul>
                    {section.plans.length > 1 ? (
                      <ComparisonTable plans={section.plans} kind={section.kind} />
                    ) : null}
                  </>
                )}
              </div>
            </section>
          ))
        )}

        <PricingFaq audience={audience} />
      </div>

      {user ? null : (
        // A signed-in reader's action is the checkout in the row they want; a
        // second call to sign up is a dead end. The band stays quiet so the
        // recommended row keeps the page's one `signal` fill.
        <section className="border-t border-border py-16 md:py-20">
          <div className="mx-auto flex max-w-content flex-col gap-6 px-content md:flex-row md:items-end md:justify-between md:gap-16">
            <h2 className="max-w-xl font-display text-h2 font-semibold text-balance">
              {organization ? t('close_org_line') : t('close_individual_line')}
            </h2>
            <CtaButton href={organization ? '/contact' : '/register'} tone="quiet">
              {organization ? t('close_org_cta') : t('cta_free')}
            </CtaButton>
          </div>
        </section>
      )}
    </>
  );
}
