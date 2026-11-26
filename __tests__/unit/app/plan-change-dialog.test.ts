import type { ChangePlanPreview } from '@studiq/server/lib/payment/payment-gateway';
import type * as Ui from '@studiq/ui';
import { NextIntlClientProvider } from 'next-intl';
import type * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  PlanChangeDialog,
  type PlanChangePreviewState,
} from '@/components/billing/plan-change-dialog';
import en from '@/i18n/messages/en.json';

// Dialog content renders through a portal, which a static render skips. The
// dialog parts become plain wrappers so the body is part of the markup.
vi.mock('@studiq/ui', async (importOriginal) => {
  const react = await vi.importActual<typeof React>('react');
  const wrapper = ({ children }: { children?: React.ReactNode }) =>
    react.createElement('div', null, children);
  return {
    ...(await importOriginal<typeof Ui>()),
    Dialog: wrapper,
    DialogContent: wrapper,
    DialogDescription: wrapper,
    DialogFooter: wrapper,
    DialogHeader: wrapper,
    DialogTitle: wrapper,
  };
});

const preview: ChangePlanPreview = {
  direction: 'upgrade',
  currentPlanKey: 'ace',
  targetPlanKey: 'pro',
  amountDue: 3999,
  currency: 'PLN',
  effectiveAt: '2026-11-26T12:00:00.000Z',
  resumesAtPeriodEnd: false,
  replacesPendingPlanKey: null,
  blockedBySchedule: false,
};

function render(
  state: PlanChangePreviewState,
  currentPlanName = 'StudiQ Ace',
  replacedPlanName = 'StudiQ Plus',
) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages: en, timeZone: 'UTC' },
      createElement(PlanChangeDialog, {
        open: true,
        state,
        currentPlanName,
        targetPlanName: 'StudiQ Max',
        replacedPlanName,
        applying: false,
        onOpenChange: () => {},
        onConfirm: () => {},
        onRetry: () => {},
        onKeepCurrentPlan: () => {},
      }),
    ),
  );
}

describe('PlanChangeDialog', () => {
  it('shows the current plan, the target plan, the amount due today and the effective date', () => {
    const markup = render({ status: 'ready', preview });

    expect(markup).toContain('StudiQ Ace');
    expect(markup).toContain('StudiQ Max');
    expect(markup).toContain(en.BillingPage.plan_change_amount);
    expect(markup).toContain('39.99');
    expect(markup).toContain(en.BillingPage.plan_change_effective);
    expect(markup).toContain('11/26/2026');
  });

  it('says a change resumes a scheduled cancellation', () => {
    const markup = render({
      status: 'ready',
      preview: { ...preview, resumesAtPeriodEnd: true },
    });

    expect(markup).toContain(en.BillingPage.plan_change_resume_notice);
  });

  it('says a change replaces a scheduled change', () => {
    const markup = render({
      status: 'ready',
      preview: { ...preview, replacesPendingPlanKey: 'spark' },
    });

    expect(markup).toContain('This change replaces your scheduled change to StudiQ Plus.');
  });

  it('offers to keep the current plan, not Confirm, when a schedule blocks the preview', () => {
    const markup = render({
      status: 'ready',
      preview: { ...preview, blockedBySchedule: true, replacesPendingPlanKey: 'spark' },
    });

    expect(markup).toContain(
      'You already have a scheduled change to StudiQ Plus. Keep your current plan before choosing another.',
    );
    expect(markup).toContain(en.BillingPage.keep_current_plan);
    expect(markup).not.toContain(en.BillingPage.plan_change_confirm);
    expect(markup).not.toContain(en.BillingPage.retry);
  });

  it('omits the resume notice when the subscription does not cancel', () => {
    expect(render({ status: 'ready', preview })).not.toContain(
      en.BillingPage.plan_change_resume_notice,
    );
  });

  it('shows a preview error with a retry instead of a confirm action', () => {
    const markup = render({ status: 'error' });

    expect(markup).toContain(en.BillingPage.plan_change_preview_failed);
    expect(markup).toContain(en.BillingPage.retry);
    expect(markup).not.toContain(en.BillingPage.plan_change_confirm);
  });

  it('holds the confirm action while the amount is loading', () => {
    const markup = render({ status: 'loading' });

    expect(markup).toContain(en.BillingPage.plan_change_preview_loading);
    expect(markup).not.toContain(en.BillingPage.plan_change_confirm);
  });
});
