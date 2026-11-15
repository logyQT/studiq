'use client';

import { AccountType } from '@studiq/authz';
import { BillingPage } from '@/components/billing/billing-page';

/** Educator billing (#662 §7.4): same effective plan and subscription read model as the student app. */
export default function EduBillingPage() {
  return <BillingPage accountType={AccountType.EDUCATOR} upgradePath="/edu/upgrade" />;
}
