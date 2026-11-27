import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The upgrade grid is four plan cards on every personal dashboard. Its column
 * count is measured on the viewport, but the dashboard content column is inset by
 * the 16rem sidebar and its padding: at 1036 px the four tracks were 161 px wide,
 * so the Max card left the content box and the price of Pro and Max was clipped.
 *
 * This is a source check, not a render test: `UpgradePlans` calls `useAuth` and
 * `useApiQuery`, so the unit environment has no provider to render it under, and
 * the loading state would hide the grid. The rendered claim lives in the QA
 * corpus. Here, returning the four-track rule to `lg` (or dropping `min-w-0`)
 * turns this red.
 */
const GRID = path.join(process.cwd(), 'apps/web/src/components/billing/upgrade-plans.tsx');

function gridClasses(source: string): string[] {
  const match = /<div className="([^"]*\bgrid\b[^"]*)"/.exec(source);
  if (!match) throw new Error('the upgrade grid element is missing');
  return match[1].split(/\s+/);
}

describe('upgrade plan grid', () => {
  const classes = gridClasses(readFileSync(GRID, 'utf8'));

  it('reaches four columns only at xl, where the content column can hold them', () => {
    expect(classes).toContain('xl:grid-cols-4');
    expect(classes).not.toContain('lg:grid-cols-4');
    expect(classes).toContain('sm:grid-cols-2');
  });

  it('lets a card shrink below its content width', () => {
    // A grid item defaults to `min-width: auto`: a long price then widens its
    // track instead of wrapping, which is what pushed the fourth card off screen.
    expect(classes).toContain('min-w-0');
  });
});
