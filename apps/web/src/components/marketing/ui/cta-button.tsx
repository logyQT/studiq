import Link from 'next/link';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { cn } from '@/lib/utils';

type Tone = 'signal' | 'quiet';

interface CtaButtonProps {
  href: string;
  children: React.ReactNode;
  tone?: Tone;
  /**
   * `lg` is the phone panel's action: 48px tall and set at the panel's own label
   * size, because it is the last thing in a full-bleed sheet rather than one of
   * two buttons on paper.
   */
  size?: 'md' | 'lg';
  /** Fills the column: the panel's CTA is the sheet's width, not a floating pill. */
  fullWidth?: boolean;
  /** Runs before the navigation commits — a panel button closes its sheet this way. */
  onClick?: () => void;
}

const TONE: Record<Tone, string> = {
  // 44px tall, not the kit's 40px: DESIGN.md §Accessibility promises it for CTAs.
  signal: 'bg-signal text-signal-foreground hover:bg-signal/90',
  quiet: 'border border-input text-foreground hover:bg-secondary',
};

const SIZE: Record<NonNullable<CtaButtonProps['size']>, string> = {
  md: 'h-11 text-sm',
  lg: 'h-12 text-base',
};

export function CtaButton({
  href,
  children,
  tone = 'signal',
  size = 'md',
  fullWidth = false,
  onClick,
}: CtaButtonProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control px-6 font-semibold transition-colors',
        SIZE[size],
        fullWidth && 'w-full',
        TONE[tone],
        FOCUS_RING,
      )}
    >
      {children}
    </Link>
  );
}
