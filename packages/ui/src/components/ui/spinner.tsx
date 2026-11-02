import { Loader2Icon } from 'lucide-react';

import { cn } from '../../utils';

function Spinner({ className, ...props }: React.ComponentProps<'output'>) {
  // `<output>` is the semantic home of `role="status"`; the icon keeps the caller's classes so
  // sizing/positioning (`<Spinner className="h-4 w-4" />`) still targets the spinner itself.
  return (
    <output aria-label="Loading" className="inline-flex" {...props}>
      <Loader2Icon aria-hidden="true" className={cn('size-4 animate-spin', className)} />
    </output>
  );
}

export { Spinner };
