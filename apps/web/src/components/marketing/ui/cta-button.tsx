import Link from 'next/link';

type Tone = 'signal' | 'quiet';

interface CtaButtonProps {
  href: string;
  children: React.ReactNode;
  tone?: Tone;
}

const TONE: Record<Tone, string> = {
  // 44px tall, not the kit's 40px: DESIGN.md §Accessibility promises it for CTAs.
  signal: 'bg-signal text-signal-foreground hover:bg-signal/90',
  quiet: 'border border-input text-foreground hover:bg-secondary',
};

export function CtaButton({ href, children, tone = 'signal' }: CtaButtonProps) {
  return (
    <Link
      href={href}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-control px-6 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none ${TONE[tone]}`}
    >
      {children}
    </Link>
  );
}
