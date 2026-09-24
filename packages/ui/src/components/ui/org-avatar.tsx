import Image from 'next/image';
import { cn } from '@/utils';

type OrgAvatarProps = {
  orgId: string;
  name?: string;
  size?: number;
  className?: string;
  /** Org's uploaded logo (branding feature); falls back to the generated avatar when unset. */
  logoUrl?: string | null;
};

export function OrgAvatar({ orgId, name, size = 32, className, logoUrl }: OrgAvatarProps) {
  const seed = encodeURIComponent(orgId);

  return (
    <Image
      src={logoUrl || `/api/v1/avatar/org/${seed}`}
      alt={name ?? ''}
      width={size}
      height={size}
      unoptimized={!!logoUrl}
      className={cn('rounded shrink-0', logoUrl ? 'object-contain' : '', className)}
    />
  );
}
