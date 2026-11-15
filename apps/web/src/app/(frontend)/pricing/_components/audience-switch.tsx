'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type PricingAudience = 'individual' | 'organization';

const OPTIONS = ['individual', 'organization'] as const;

interface AudienceSwitchProps {
  value: PricingAudience;
  onChange: (audience: PricingAudience) => void;
  /** Id of the region the radios swap, so `aria-controls` points at real content. */
  controls: string;
}

/**
 * A native radio group, not a widget: arrow keys, roving focus and the
 * "one of two" announcement are the platform's, and the segments are labels over
 * `sr-only` inputs. Full width at phone, intrinsic from `sm`.
 */
export function AudienceSwitch({ value, onChange, controls }: AudienceSwitchProps) {
  const t = useTranslations('PricingPage');

  return (
    <fieldset className="w-full sm:w-fit">
      {/* Visible and programmatic name at once: a second `aria-label` would repeat it. */}
      <legend className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
        {t('switch_legend')}
      </legend>
      <div
        className={cn(
          'mt-2 flex overflow-hidden rounded-control border border-input sm:inline-flex',
          // FOCUS_RING moved to the pair: the focused input is `sr-only`, so a
          // ring on it would draw a 1px box. The segments share one 1px edge, so
          // a per-segment ring would sit on its neighbour.
          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background has-[:focus-visible]:outline-none',
        )}
      >
        {OPTIONS.map((option, index) => (
          <label
            key={option}
            className={cn(
              'flex min-h-11 flex-1 cursor-pointer items-center justify-center px-5 text-sm font-semibold transition-colors select-none sm:flex-none',
              index > 0 && 'border-l border-input',
              value === option
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-accent',
            )}
          >
            <input
              type="radio"
              name="pricing-audience"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              aria-controls={controls}
              className="sr-only"
            />
            {t(`audience_${option}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
