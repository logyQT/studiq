'use client';

import { PaymentHistoryContent } from '@/components/account/PaymentHistoryContent';

export default function AppAccountPaymentsPage() {
  return <PaymentHistoryContent billingHref="/app/billing" />;
}
