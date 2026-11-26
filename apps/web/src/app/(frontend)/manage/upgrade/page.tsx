'use client';

import { UpgradePlans } from '@/components/billing/upgrade-plans';
import { useOrgs } from '@/hooks/use-orgs';

export default function ManageUpgradePage() {
  const { activeOrg } = useOrgs();

  return <UpgradePlans scope="organization" orgId={activeOrg?.id} />;
}
