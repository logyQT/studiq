import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AccountType } from '@/types';

const ACCOUNT_TYPE_COLORS: Partial<Record<AccountType, string>> = {
  [AccountType.MANAGER]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  [AccountType.EDUCATOR]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  [AccountType.STUDENT]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
};

const ACCOUNT_TYPE_LABELS: Partial<Record<AccountType, string>> = {
  [AccountType.MANAGER]: 'Manager',
  [AccountType.EDUCATOR]: 'Educator',
  [AccountType.STUDENT]: 'Student',
};

interface AccountTypeBadgeProps {
  accountType: AccountType;
  className?: string;
}

export function AccountTypeBadge({ accountType, className }: AccountTypeBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn('font-medium', ACCOUNT_TYPE_COLORS[accountType], className)}
    >
      {ACCOUNT_TYPE_LABELS[accountType]}
    </Badge>
  );
}
