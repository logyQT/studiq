import Image from 'next/image';
import { cn } from '@/lib/utils';

type UserAvatarProps = {
  name?: string | null;
  email?: string | null;
  size?: number;
  className?: string;
};

export function UserAvatar({ name, email, size = 32, className }: UserAvatarProps) {
  const seed = encodeURIComponent(name || email || '?');

  return (
    <Image
      src={`/api/v1/avatar/user/${seed}`}
      alt=""
      width={size}
      height={size}
      className={cn('rounded shrink-0', className)}
    />
  );
}
