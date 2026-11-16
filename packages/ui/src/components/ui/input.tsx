import type * as React from 'react';

import { cn } from '../../utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // An opaque `card` surface: the edge's 3:1 is measured against the fill, so the fill
        // cannot be a mix of the edge's own colour. Opting the ring out needs
        // `focus-visible:ring-offset-0` too — the offset paints even at ring width 0.
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-card border-input h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        // Solid ring: `ring-ring/50` measures 2.45:1 over the page and fades out on blur.
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'aria-invalid:border-destructive aria-invalid:ring-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
