'use client';

import type { PaymentHistoryItem } from '@studiq/server/services/payment.service';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { CreditCard, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { paymentKeys } from '@/lib/query-keys';

interface PaymentHistoryContentProps {
  /** Where "Manage billing" points (`/app/billing` or `/edu/billing`). */
  billingHref: string;
}

/**
 * Shared body of `/app/account/payments` and `/edu/account/payments` (#392).
 * Before this the page was a hard-coded placeholder that claimed "Brak
 * płatności" even after a completed checkout.
 */
export function PaymentHistoryContent({ billingHref }: PaymentHistoryContentProps) {
  const t = useTranslations('AccountPage');
  const locale = useLocale();
  const { user } = useAuth();

  // `staleTime: 0` is deliberate: `useApiQuery` defaults to `Infinity` and the
  // checkout is client-side, so a cached pre-purchase empty list would survive
  // the checkout → success → dashboard navigation.
  const {
    data: payments,
    isLoading,
    isError,
  } = useApiQuery<PaymentHistoryItem[]>({
    queryKey: paymentKeys.all,
    url: '/api/v1/me/payments',
    enabled: !!user,
    staleTime: 0,
  });

  const isEmpty = !isLoading && !isError && (payments?.length ?? 0) === 0;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('payments_title')}</h1>
        <p className="text-muted-foreground mt-1">{t('payments_subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('payments_title')}</CardTitle>
          {isEmpty && <CardDescription>{t('no_payments')}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {isError && <p className="text-destructive text-sm">{t('payments_load_failed')}</p>}

          {!isLoading && !isError && (payments?.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('payment_plan')}</TableHead>
                  <TableHead className="text-right">{t('payment_amount')}</TableHead>
                  <TableHead className="text-right">{t('payment_date')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments?.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">{payment.planName}</TableCell>
                    <TableCell className="text-right">
                      {new Intl.NumberFormat(locale, {
                        style: 'currency',
                        currency: payment.currency,
                      }).format(payment.amount / 100)}
                    </TableCell>
                    <TableCell className="text-right">
                      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                        new Date(payment.paidAt),
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Button asChild>
            <Link href={billingHref}>
              <CreditCard className="size-4 mr-2" />
              {t('manage_billing')}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
