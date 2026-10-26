import { Check } from 'lucide-react';

type ComparisonCellProps = {
  included: boolean;
  /** Spoken value for an included feature, e.g. "Tak". */
  yesLabel: string;
  /** Spoken value for a missing feature, e.g. "Nie". */
  noLabel: string;
  /** Colour of the check icon (matches the plan column). */
  checkClassName: string;
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
}: ComparisonCellProps) {
  return (
    <td className="text-center py-3 px-4">
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
