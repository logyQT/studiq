'use client';

import { AccountType } from '@studiq/authz';
import { BillingPage } from '@/components/billing/billing-page';

/**
 * Educator billing (#662 §7.4): the same read model as the student app, scoped
 * to the educator's own subscription rather than their active organization's.
 */
export default function EduBillingPage() {
  return <BillingPage accountType={AccountType.EDUCATOR} upgradePath="/edu/upgrade" personal />;
}
