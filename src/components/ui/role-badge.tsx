import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { UserRole } from '@/types';

const ROLE_COLORS: Record<UserRole, string> = {
  [UserRole.SYS_ADMIN]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  [UserRole.UNIVERSITY_ADMIN]:
    'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  [UserRole.TEACHER]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  [UserRole.STUDENT]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  [UserRole.PREMIUM]: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  [UserRole.FREE]: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SYS_ADMIN]: 'Sys Admin',
  [UserRole.UNIVERSITY_ADMIN]: 'Uni Admin',
  [UserRole.TEACHER]: 'Teacher',
  [UserRole.STUDENT]: 'Student',
  [UserRole.PREMIUM]: 'Premium',
  [UserRole.FREE]: 'Free',
};

interface RoleBadgeProps {
  role: UserRole;
  className?: string;
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn('font-medium', ROLE_COLORS[role], className)}
    >
      {ROLE_LABELS[role]}
    </Badge>
  );
}
