'use client';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@studiq/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
// `CONTROL_RADIUS` spells the token's value out because `cn` cannot collapse the
// marketing name against the kit's `rounded-md`, which would then win the cascade.
import { CONTROL_RADIUS, CONTROL_SURFACE } from '@/components/shared/preference-controls';
import { cn } from '@/lib/utils';

interface AuthFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues>;
  name: TName;
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  placeholder?: string;
  /** Only a password field passes this; every other field is a text input. */
  type?: 'password';
  autoComplete?: string;
  description?: string;
  /** The password field puts its reset link on the label row. */
  labelAction?: ReactNode;
}

/**
 * The typed field on the two credential pages, declared once because `/login` and
 * `/register` are read side by side: a second copy would drift into a second field
 * treatment, and `dup:changed` rejects the copy before a reviewer sees it.
 *
 * The mark sits inside the control, so the input's left padding and the mark's
 * position are a single decision. `FormControl` has to own the `<input>` itself: it
 * is a Radix `Slot`, so whatever element it wraps receives `aria-describedby` /
 * `aria-invalid`. Wrapping the icon's `<div>` put both attributes on that div
 * instead, and the field's message was never announced with it.
 */
export function AuthField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  control,
  name,
  label,
  icon: Icon,
  disabled,
  placeholder,
  type,
  autoComplete,
  description,
  labelAction,
}: AuthFieldProps<TValues, TName>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          {/* One row either way: the action, when there is one, sits at the trailing edge. */}
          <div className="flex items-center justify-between gap-2">
            <FormLabel htmlFor={field.name}>{label}</FormLabel>
            {labelAction}
          </div>
          <div className="relative">
            <Icon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <FormControl>
              <Input
                id={field.name}
                type={type}
                autoComplete={autoComplete}
                placeholder={placeholder}
                className={cn(
                  'pl-9',
                  CONTROL_SURFACE,
                  CONTROL_RADIUS,
                  fieldState.error && 'border-destructive focus-visible:ring-destructive',
                )}
                disabled={disabled}
                {...field}
              />
            </FormControl>
          </div>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
