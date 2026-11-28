'use client';

import { Button, DialogFooter } from '@studiq/ui';

interface ContentFormFooterProps {
  cancelLabel: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
  /** A group-visible item with no group, or another state the server would refuse. */
  submitDisabled?: boolean;
}

/** Cancel and save, in the one order every content form shows them. */
export function ContentFormFooter({
  cancelLabel,
  submitLabel,
  onCancel,
  onSubmit,
  submitDisabled,
}: ContentFormFooterProps) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button disabled={submitDisabled} onClick={onSubmit}>
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}
