import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Seats are frozen at the UI (#1493): the organization ladder is capacity only,
 * so a sold seat has no feature to add and organization licences arrive in
 * #1511. The read path stays — pools and assignments are data #1511 builds on —
 * and the API keeps its own authority checks. Only the purchase, assign and
 * release entries are gone.
 *
 * This is a source check, not a render test: the page is a client component whose
 * tables arrive from an effect, and the unit environment has no DOM, so a static
 * render would only see the loading state. The rendered assertion lives in the QA
 * corpus — `MGR-SEAT-02` and `MGR-SEAT-03` drive the served `/manage/seats` and
 * assert the three controls are absent. Here, restoring a control or a mutating
 * call in the source turns this red.
 */
const PAGE = path.join(process.cwd(), 'apps/web/src/app/(frontend)/manage/seats/page.tsx');

describe('manage seats page source is read-only (#1493)', () => {
  const source = readFileSync(PAGE, 'utf8');

  it('keeps the GET data path for pools and assignments', () => {
    expect(source).toContain('/api/v1/organization/seats/pools');
    expect(source).toContain('/api/v1/organization/seats/assignments');
    expect(source).toContain('SeatPoolsTable');
  });

  it('does not render the purchase, assign or release entries', () => {
    for (const key of ['purchase_seats', 'assign_seat', 'release_seat']) {
      expect(source, `the ${key} control came back`).not.toContain(key);
    }
  });

  it('makes no mutating request', () => {
    expect(source).not.toContain('apiPost');
    expect(source).not.toContain("method: 'DELETE'");
  });
});
