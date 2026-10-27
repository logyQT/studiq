import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComparisonCell } from '@/components/marketing/comparison-cell';

// #291: the /features comparison table cells were a bare icon (aria-hidden) or an em dash, so a
// screen reader announced every included cell as blank and every missing one as "—".

function render(included: boolean) {
  // A <td> must sit in a row to be valid markup; the wrapper only keeps the parser honest.
  return renderToStaticMarkup(
    createElement(
      'table',
      null,
      createElement(
        'tbody',
        null,
        createElement(
          'tr',
          null,
          createElement(ComparisonCell, {
            included,
            yesLabel: 'Tak',
            noLabel: 'Nie',
            checkClassName: 'text-primary',
          }),
        ),
      ),
    ),
  );
}

describe('ComparisonCell', () => {
  it('announces an included feature as the yes label and hides the icon', () => {
    const html = render(true);

    expect(html).toContain('<span class="sr-only">Tak</span>');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('Nie');
  });

  it('announces a missing feature as the no label and hides the dash', () => {
    const html = render(false);

    expect(html).toContain('<span class="sr-only">Nie</span>');
    expect(html).toContain('<span aria-hidden="true" class="text-muted-foreground/50">—</span>');
    expect(html).not.toContain('Tak');
  });

  it('keeps the plan colour on the icon', () => {
    expect(render(true)).toContain('text-primary');
  });
});
