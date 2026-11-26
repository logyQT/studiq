'use client';

import { AccountType } from '@studiq/authz';
import { BillingPage } from '@/components/billing/billing-page';
import { useManagerRedirect } from '@/hooks/use-manager-redirect';

/** Personal billing: this reader's own subscription, never the active organization's. */
export default function AppBillingPage() {
  const isManager = useManagerRedirect('/manage/billing');
  if (isManager) return null;
  return <BillingPage accountType={AccountType.STUDENT} upgradePath="/app/upgrade" personal />;
}
