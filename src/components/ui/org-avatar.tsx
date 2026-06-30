import Image from 'next/image';
import { cn } from '@/lib/utils';

type OrgAvatarProps = {
  orgId: string;
  name?: string;
  size?: number;
  className?: string;
};

export function OrgAvatar({ orgId, name, size = 32, className }: OrgAvatarProps) {
  const seed = encodeURIComponent(orgId);

  return (
    <Image
      src={`/api/v1/avatar/org/${seed}`}
      alt={name ?? ''}
      width={size}
      height={size}
      className={cn('rounded shrink-0', className)}
    />
  );
}
