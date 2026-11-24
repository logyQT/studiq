import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AreaGate } from '@/components/layout/area-gate';
import pl from '@/i18n/messages/pl.json';

/**
 * The gate's failure path. A failed `/me/orgs`, a failed permission map and a
 * failed first-org auto-selection all leave the active org unresolved, so the
 * gate must distinguish "nothing failed yet, wait" from "this failed, retry" —
 * the auto-select one especially, because the hook's one-shot latch is spent and
 * a refetch can never re-run the switch. The skeleton is the wrong answer there.
 */
const gate = vi.hoisted(() => ({
  autoSelectError: false,
  orgsError: false,
  permissionsError: false,
}));

vi.mock('@/hooks/use-orgs', () => ({
  useOrgs: () => ({
    // A failed permission read is only reachable once an org is active; the
    // auto-select failure cases deliberately leave it `null`.
    activeOrg: gate.permissionsError
      ? {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Organizacja',
          slug: 'organizacja',
          orgRoleName: 'Admin',
          orgRoleId: '22222222-2222-4222-8222-222222222222',
          isActive: true,
          canBill: false,
        }
      : null,
    orgs: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Organizacja',
        slug: 'organizacja',
        orgRoleName: 'Admin',
        orgRoleId: '22222222-2222-4222-8222-222222222222',
        isActive: false,
        canBill: false,
      },
    ],
    switchOrg: () => {},
    isSwitching: false,
    isLoading: false,
    isError: gate.orgsError,
    refetch: () => {},
    autoSelectError: gate.autoSelectError,
    retryAutoSelect: () => {},
  }),
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    isPending: false,
    isError: gate.permissionsError,
    data: gate.permissionsError ? undefined : { orgId: null, permissions: {} },
    refetch: () => {},
  }),
}));

const locale = 'pl';
const t = createTranslator({ locale, messages: pl, namespace: 'AreaGate' });

function render(): string {
  const child: ReactNode = createElement('p', null, 'area children');
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: pl, timeZone: 'UTC' },
      createElement(AreaGate, { area: '/manage' }, child),
    ),
  );
}

describe('AreaGate failure card', () => {
  beforeEach(() => {
    gate.autoSelectError = false;
    gate.orgsError = false;
    gate.permissionsError = false;
  });

  it('offers a retry when the first-org auto-selection failed, not a skeleton', () => {
    gate.autoSelectError = true;

    const html = render();

    expect(html).toContain('data-slot="area-gate-error"');
    expect(html).toContain(t('load_error'));
    expect(html).toContain(t('retry'));
    expect(html).not.toContain('data-slot="area-gate-pending"');
    expect(html).not.toContain('area children');
  });

  it('waits on the skeleton while that switch has not run yet', () => {
    // Same `null` active org as the failure above, without the failure signal.
    const html = render();

    expect(html).toContain('data-slot="area-gate-pending"');
    expect(html).not.toContain('data-slot="area-gate-error"');
  });

  it('offers a retry for a failed membership read', () => {
    gate.orgsError = true;

    expect(render()).toContain('data-slot="area-gate-error"');
  });

  it('offers a retry for a failed permission read', () => {
    gate.permissionsError = true;

    expect(render()).toContain('data-slot="area-gate-error"');
  });
});
