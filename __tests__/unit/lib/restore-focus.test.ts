import { restoreFocusIfLost } from '@studiq/ui/components/ui/restore-focus';
import { describe, expect, it, vi } from 'vitest';

// #190: closing a dialog that has no Radix <Trigger> (opened from a plain button, controlled
// through `open` state) left focus on <body>. The dialog now hands focus back to the element
// that opened it, but only when nothing else has taken focus in the meantime.

function fakeDocument(active: unknown) {
  const body = {};
  return { body, activeElement: active ?? body } as unknown as Document;
}

function fakeElement(isConnected = true) {
  return { isConnected, focus: vi.fn() } as unknown as HTMLElement;
}

describe('restoreFocusIfLost', () => {
  it('focuses the opener when focus fell back to <body>', () => {
    const opener = fakeElement();

    expect(restoreFocusIfLost(opener, fakeDocument(null))).toBe(true);
    expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('leaves focus alone when something else already has it (e.g. the Radix trigger)', () => {
    const opener = fakeElement();

    expect(restoreFocusIfLost(opener, fakeDocument({}))).toBe(false);
    expect(opener.focus).not.toHaveBeenCalled();
  });

  it('does nothing when the opener is gone from the page', () => {
    const opener = fakeElement(false);

    expect(restoreFocusIfLost(opener, fakeDocument(null))).toBe(false);
    expect(opener.focus).not.toHaveBeenCalled();
  });

  it('does nothing without an opener', () => {
    expect(restoreFocusIfLost(null, fakeDocument(null))).toBe(false);
  });
});
