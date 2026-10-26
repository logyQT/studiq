import { useIsMobile } from '@studiq/ui';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// #190: the sidebar renders different markup for mobile and desktop. The hook used to read
// window.innerWidth while initialising its state, so on a narrow viewport the first client
// render (isMobile = true) did not match the server HTML (isMobile = false) and React logged
// "Hydration failed". The first render must always be the server value; the effect corrects it.

function Probe() {
  return createElement('span', null, String(useIsMobile()));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useIsMobile', () => {
  it('renders the server value first, even when the viewport is already narrow', () => {
    vi.stubGlobal('window', { innerWidth: 375 });

    expect(renderToString(createElement(Probe))).toContain('false');
  });

  it('renders the server value first on a wide viewport as well', () => {
    vi.stubGlobal('window', { innerWidth: 1280 });

    expect(renderToString(createElement(Probe))).toContain('false');
  });
});
