import { restoreFocusIfLost } from '@studiq/ui/components/ui/restore-focus';
import { describe, expect, it, vi } from 'vitest';

// #190: closing a dialog that has no Radix <Trigger> (opened from a plain button, controlled
// through `open` state) left focus on <body>. The dialog now hands focus back to the element
// that opened it, but only when nothing else has taken focus in the meantime.

/**
 * The unit environment has no DOM, so the stubs below stand in for the members
 * `restoreFocusIfLost` reads. This helper is the single place crossing that boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T names the DOM type the stub stands in for; it is the caller's only input
function domStub<T>(node: object): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- no DOM in the unit env; the stub answers every member the code reads
  return node as T;
}

function fakeDocument(active: unknown): Document {
  const body = {};
  return domStub<Document>({ body, activeElement: active ?? body });
}

function fakeElement(isConnected = true): HTMLElement {
  return domStub<HTMLElement>({ isConnected, focus: vi.fn() });
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
