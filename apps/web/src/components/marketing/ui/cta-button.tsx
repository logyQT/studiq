import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { cn } from '@/lib/utils';

type Tone = 'signal' | 'primary' | 'quiet';

interface CtaButtonBaseProps {
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
  /** Layout only — a price list's action column is narrower than the copy around it. */
  className?: string;
}

interface CtaLinkProps extends CtaButtonBaseProps {
  href: string;
  /** Runs before the navigation commits — a panel button closes its sheet this way. */
  onClick?: () => void;
  submit?: never;
  disabled?: never;
  action?: never;
}

/**
 * A form's own submit, carrying the same fill and 44px height as the links. It is
 * not a second component: one page has one primary action, and two button
 * implementations would drift into two looks for it.
 *
 * The branch is a literal rather than a fallback. `href` is what a marketing CTA
 * is, so omitting it has to be a compile error, not a `type="submit"` button on a
 * page with no form to submit.
 */
interface CtaSubmitProps extends CtaButtonBaseProps {
  submit: true;
  disabled?: boolean;
  href?: never;
  onClick?: never;
  action?: never;
}

/**
 * A handler button: the plan checkout posts, then sends the window to the payment
 * page. It carries the link's class builder, so a row that mixes a navigation and
 * a POST does not mix two button looks.
 *
 * `onClick` is optional because a disabled action (`cta_current`) has nothing to
 * run; `loading` disables the button and shows the spinner in its label.
 */
interface CtaActionProps extends CtaButtonBaseProps {
  action: 'button';
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  href?: never;
  submit?: never;
}

type CtaButtonProps = CtaLinkProps | CtaSubmitProps | CtaActionProps;

const TONE: Record<Tone, string> = {
  // 44px tall, not the kit's 40px: DESIGN.md §Accessibility promises it for CTAs.
  signal: 'bg-signal text-signal-foreground hover:bg-signal/90',
  /*
   * The brand fill, for a page whose action sits beside the cobalt panel instead of
   * on paper alone (`/register`): paper on cobalt is 7.15:1 in light, ink on cobalt
   * 6.48:1 in dark. Hover steps the fill itself back 10%, which keeps 5.83:1 and
   * 5.43:1; `--cobalt-hover` is the token for the hover of a cobalt fill, but at
   * 4.47:1 under paper text it cannot carry this label.
   */
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  quiet: 'border border-input text-foreground hover:bg-secondary',
};

const SIZE: Record<NonNullable<CtaButtonBaseProps['size']>, string> = {
  md: 'h-11 text-sm',
  lg: 'h-12 text-base',
};

export function CtaButton(props: CtaButtonProps) {
  const { children, tone = 'signal', size = 'md', fullWidth = false, className: extra } = props;
  const className = cn(
    'inline-flex items-center justify-center gap-2 rounded-control px-6 font-semibold transition-colors',
    // A disabled element still matches `:hover`, so suppress the pointer instead.
    'disabled:pointer-events-none',
    SIZE[size],
    fullWidth && 'w-full',
    TONE[tone],
    extra,
    FOCUS_RING,
  );

  if ('submit' in props) {
    return (
      <button
        type="submit"
        disabled={props.disabled}
        className={cn(className, 'disabled:opacity-60')}
      >
        {children}
      </button>
    );
  }

  if (props.action === 'button') {
    return (
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled || props.loading}
        className={cn(className, 'disabled:opacity-60')}
      >
        {props.loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        {children}
      </button>
    );
  }

  return (
    <Link href={props.href} onClick={props.onClick} className={className}>
      {children}
    </Link>
  );
}
