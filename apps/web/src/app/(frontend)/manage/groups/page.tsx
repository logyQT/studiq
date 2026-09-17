'use client';

import { useTranslations } from 'next-intl';
import { GroupManagementScreen } from '@/components/groups/group-management-screen';

export default function GroupsPage() {
  const t = useTranslations('ManageGroupsPage');
  return <GroupManagementScreen t={t} />;
}
