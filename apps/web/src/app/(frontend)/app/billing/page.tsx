'use client';

import { AccountType } from '@studiq/authz';
import { BillingPage } from '@/components/billing/billing-page';

/** Personal billing: this reader's own subscription, never the active organization's. */
export default function AppBillingPage() {
  return <BillingPage accountType={AccountType.STUDENT} upgradePath="/app/upgrade" personal />;
}
