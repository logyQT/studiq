'use client';

import { Button, Card, CardContent, Skeleton } from '@studiq/ui';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/shared/empty-state';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermissions } from '@/hooks/use-permissions';
import { type DashboardArea, areaGateState } from '@/lib/dashboard-home';

type GatedArea = Extract<DashboardArea, '/manage' | '/edu'>;

/**
 * The org-scoped "no access" state of an area (ADR-0015 §7.1, §14.1).
 *
 * A bookmarked `/manage/...` or `/edu/...` URL in an organization where the
 * caller holds none of the area's keys must **load**, keep its URL and say so —
 * not redirect and not 404. The API stays the boundary (the page's own reads are
 * 403 or the empty deny shape); this component only makes the shell honest
 * instead of rendering a wall of error cards under links the sidebar offered.
 *
 * No flash and no redirect: while `/me/orgs` is loading, a settled membership
 * list has no active org yet (the auto-selection is still to run, so the map
 * describes the personal layer), the active org's `['permissions', orgId]` is
 * unresolved, or the answer names a different org than the active one — the way
 * a payload written under the outgoing key does — the gate renders a neutral
 * placeholder and neither the children nor the card. `areaGateState` holds that
 * rule, the same one the landing applies.
 *
 * A failed read is neither a denial nor a wait. The gate renders a retry card
 * and the retry re-runs the read that failed: a membership refetch, a permission
 * refetch, or — when the first-org switch itself failed — that switch again,
 * which is the one failure a plain refetch cannot cure because the hook's
 * one-shot latch has already fired. The copy is the gate's own rather than
 * `/dashboard`'s: the landing offers "sign in again" with no such control here,
 * and this card's only way out is the retry.
 *
 * The action is the org switcher: one button per *other* organization, which is
 * where the caller's authority may live. With a single membership there is
 * nothing to switch to, so the fallback is the caller's own space.
 */
export function AreaGate({ area, children }: { area: GatedArea; children: React.ReactNode }) {
  const t = useTranslations('AreaGate');
  const {
    activeOrg,
    orgs,
    switchOrg,
    isSwitching,
    isLoading,
    isError: orgsError,
    refetch: refetchOrgs,
    autoSelectError,
    retryAutoSelect,
  } = useOrgs();
  const permissions = usePermissions();

  const decision = areaGateState(
    {
      orgsLoading: isLoading,
      orgsError,
      orgsCount: orgs.length,
      activeOrgId: activeOrg?.id ?? null,
      autoSelectError,
      permissions,
    },
    area,
  );

  if (decision.state === 'error') {
    const retry =
      decision.source === 'orgs'
        ? () => {
            void refetchOrgs();
          }
        : decision.source === 'permissions'
          ? () => {
              void permissions.refetch();
            }
          : retryAutoSelect;

    return (
      <Card data-slot="area-gate-error">
        <CardContent className="p-0">
          <EmptyState
            icon={AlertCircle}
            role="alert"
            title={t('load_error')}
            description={t('load_error_desc')}
            action={<Button onClick={retry}>{t('retry')}</Button>}
          />
        </CardContent>
      </Card>
    );
  }

  if (decision.state === 'pending') {
    return (
      <div className="space-y-4" aria-busy="true" data-slot="area-gate-pending">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
    );
  }

  if (decision.state === 'allowed') return children;

  const orgId = activeOrg?.id ?? null;
  const otherOrgs = orgs.filter((org) => org.id !== orgId);

  return (
    <Card data-slot="area-gate">
      <CardContent className="p-0">
        <EmptyState
          icon={ShieldAlert}
          role="alert"
          title={t('no_access_title')}
          description={
            activeOrg
              ? t('no_access_description', { org: activeOrg.name })
              : t('no_access_description_no_org')
          }
          action={
            otherOrgs.length > 0 ? (
              <div className="flex flex-col items-center gap-2">
                {otherOrgs.map((org) => (
                  <Button
                    key={org.id}
                    variant="outline"
                    size="sm"
                    disabled={isSwitching}
                    onClick={() => switchOrg(org.id)}
                  >
                    {t('switch_to', { org: org.name })}
                  </Button>
                ))}
              </div>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href="/app">{t('go_to_own_space')}</Link>
              </Button>
            )
          }
        />
      </CardContent>
    </Card>
  );
}
