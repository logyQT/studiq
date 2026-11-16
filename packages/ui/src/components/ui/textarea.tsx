import type * as React from 'react';

import { cn } from '../../utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input placeholder:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-destructive flex field-sizing-content min-h-16 w-full rounded-md border bg-card px-3 py-2 text-base shadow-xs transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        // The same surface and the same solid focus ring as `Input`: the two are field
        // primitives and a form that renders both must not show two treatments.
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
