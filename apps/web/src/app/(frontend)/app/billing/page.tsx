'use client';

import { AccountType } from '@studiq/authz';
import { BillingPage } from '@/components/billing/billing-page';

export default function AppBillingPage() {
  return <BillingPage accountType={AccountType.STUDENT} upgradePath="/app/upgrade" />;
}
