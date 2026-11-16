import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type ComparisonCellProps = {
  included: boolean;
  /** Spoken value for an included feature, e.g. "Tak". */
  yesLabel: string;
  /** Spoken value for a missing feature, e.g. "Nie". */
  noLabel: string;
  /** Colour of the check icon (matches the plan column). */
  checkClassName: string;
  /** Cell geometry, for a table that has less room than another one. */
  className?: string;
};

/**
 * One value cell of the plan comparison table. The icon / dash is decorative, so the value
 * is also rendered as screen-reader text - the cell used to be blank to assistive tech (#291).
 */
export function ComparisonCell({
  included,
  yesLabel,
  noLabel,
  checkClassName,
  className,
}: ComparisonCellProps) {
  return (
    <td className={cn('text-center py-3 px-4', className)}>
      {included ? (
        <>
          <Check aria-hidden="true" className={`h-4 w-4 mx-auto ${checkClassName}`} />
          <span className="sr-only">{yesLabel}</span>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="text-muted-foreground/50">
            —
          </span>
          <span className="sr-only">{noLabel}</span>
        </>
      )}
    </td>
  );
}
