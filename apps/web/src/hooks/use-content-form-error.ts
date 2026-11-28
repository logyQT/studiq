'use client';

import { useEffect, useState } from 'react';

/**
 * The inline error of a content form dialog. A refused save keeps the dialog open with the
 * fields intact, so the message stays in the form until the dialog closes; opening it again
 * starts clean.
 */
export function useContentFormError(dialogOpen: boolean) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dialogOpen) setError(null);
  }, [dialogOpen]);

  return [error, setError] as const;
}
