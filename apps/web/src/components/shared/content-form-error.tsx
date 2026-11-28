'use client';

/**
 * The refusal line a content form shows after a failed save. `role="alert"` announces it
 * without moving focus, and the dialog keeps the fields the user typed.
 */
export function ContentFormError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <p role="alert" className="mt-3 text-sm text-destructive">
      {message}
    </p>
  );
}
