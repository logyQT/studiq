import { cn } from '@/lib/utils';

type DicebearAvatarProps = {
  seed: string | undefined;
  size?: number;
  className?: string;
};

export function DicebearAvatar({ seed, size = 32, className }: DicebearAvatarProps) {
  return (
    <img
      src={`/api/v1/avatar/${encodeURIComponent(seed ?? 'unknown')}`}
      alt=""
      width={size}
      height={size}
      className={cn('rounded-full shrink-0 ring-2 ring-border', className)}
    />
  );
}
