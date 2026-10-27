import * as React from 'react';

type FocusDocument = Pick<Document, 'activeElement' | 'body'>;

type AutoFocusHandlers = {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * Give focus back to `target` when nothing else has it.
 *
 * Exported for tests; `useRestoreFocusOnClose` is the component-facing API.
 */
export function restoreFocusIfLost(target: Element | null, doc: FocusDocument = document): boolean {
  if (!target || !('focus' in target) || !(target as HTMLElement).isConnected) return false;

  const active = doc.activeElement;
  if (active && active !== doc.body) return false;

  (target as HTMLElement).focus({ preventScroll: true });
  return true;
}

/**
 * Radix modal dialogs hand focus back to their `Trigger` on close and nothing else.
 * A dialog that is opened from a plain button and controlled through `open` state has
 * no `Trigger`, so focus fell to <body> and keyboard users lost their place (#190).
 *
 * Returns `onOpenAutoFocus` / `onCloseAutoFocus` handlers for a Radix `Content`: the
 * first remembers the element that had focus when the content opened (the wrapper
 * component mounts long before that, so it cannot be read earlier), the second restores
 * it after Radix has run its own trigger handling. A `Trigger` still wins, and so do the
 * caller's own handlers.
 */
export function useRestoreFocusOnClose({ onOpenAutoFocus, onCloseAutoFocus }: AutoFocusHandlers) {
  const opener = React.useRef<Element | null>(null);

  const handleOpen = React.useCallback(
    (event: Event) => {
      opener.current = document.activeElement;
      onOpenAutoFocus?.(event);
    },
    [onOpenAutoFocus],
  );

  const handleClose = React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      // Radix prevents the default and focuses its trigger synchronously after this
      // handler returns; only fall back to the opener if that left focus nowhere.
      queueMicrotask(() => restoreFocusIfLost(opener.current));
    },
    [onCloseAutoFocus],
  );

  return { onOpenAutoFocus: handleOpen, onCloseAutoFocus: handleClose };
}
