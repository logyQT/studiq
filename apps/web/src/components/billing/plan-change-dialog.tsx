'use client';

import type { ChangePlanPreview } from '@studiq/server/lib/payment/payment-gateway';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@studiq/ui';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDate } from '@/lib/datetime';

export type PlanChangePreviewState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; preview: ChangePlanPreview };

interface PlanChangeDialogProps {
  open: boolean;
  state: PlanChangePreviewState | null;
  currentPlanName: string;
  targetPlanName: string;
  /** The plan of a pending scheduled change this dialog may replace. */
  replacedPlanName: string;
  applying: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onRetry: () => void;
  onKeepCurrentPlan: () => void;
}

function formatMoney(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount / 100);
}

/**
 * Confirmation for a plan change. The amount and effective date come from the
 * server preview; the confirmed change is a separate call made only from
 * `onConfirm`, so opening or cancelling this dialog changes nothing.
 */
export function PlanChangeDialog({
  open,
  state,
  currentPlanName,
  targetPlanName,
  replacedPlanName,
  applying,
  onOpenChange,
  onConfirm,
  onRetry,
  onKeepCurrentPlan,
}: PlanChangeDialogProps) {
  const t = useTranslations('BillingPage');
  const locale = useLocale();
  const blocked = state?.status === 'ready' && state.preview.blockedBySchedule;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('plan_change_confirm_title')}</DialogTitle>
          <DialogDescription>{t('plan_change_confirm_description')}</DialogDescription>
        </DialogHeader>

        {state?.status === 'loading' && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('plan_change_preview_loading')}
          </div>
        )}

        {state?.status === 'error' && (
          <p className="py-2 text-sm text-destructive">{t('plan_change_preview_failed')}</p>
        )}

        {blocked && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t('plan_change_blocked_by_schedule', { plan: replacedPlanName })}
          </p>
        )}

        {state?.status === 'ready' && !blocked && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('plan_change_current')}</span>
              <span className="font-medium">{currentPlanName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('plan_change_target')}</span>
              <span className="font-medium">{targetPlanName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('plan_change_amount')}</span>
              <span className="font-medium">
                {state.preview.amountDue > 0
                  ? formatMoney(state.preview.amountDue, state.preview.currency, locale)
                  : t('plan_change_no_charge')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('plan_change_effective')}</span>
              <span className="font-medium">{formatDate(state.preview.effectiveAt, locale)}</span>
            </div>
            {state.preview.replacesPendingPlanKey && (
              <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                {t('plan_change_replaces_schedule', { plan: replacedPlanName })}
              </p>
            )}
            {state.preview.resumesAtPeriodEnd && (
              <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                {t('plan_change_resume_notice')}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            {t('plan_change_cancel')}
          </Button>
          {blocked ? (
            <Button variant="secondary" onClick={onKeepCurrentPlan} disabled={applying}>
              {t('keep_current_plan')}
            </Button>
          ) : state?.status === 'error' ? (
            <Button variant="secondary" onClick={onRetry}>
              {t('retry')}
            </Button>
          ) : state?.status === 'ready' ? (
            <Button onClick={onConfirm} disabled={applying}>
              {applying && <Loader2 className="size-4 mr-2 animate-spin" />}
              {t('plan_change_confirm')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
