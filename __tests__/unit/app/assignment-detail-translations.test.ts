import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

/**
 * The student assignment page showed hardcoded English in the Polish UI (#1519).
 *
 * This is a source check, not a render test: the page reads its data through
 * React Query and the unit environment has no provider to render it under.
 * Putting one of the old literals back, or dropping a key, turns it red.
 */
const PAGE = path.join(process.cwd(), 'apps/web/src/app/(frontend)/app/assignments/[id]/page.tsx');
const KEYS = ['scheduled_badge', 'closed_badge', 'opens', 'opens_in', 'closed_message'] as const;

describe('student assignment page translations', () => {
  const source = readFileSync(PAGE, 'utf8');

  it.each(KEYS)('uses the %s key and defines it in both languages', (key) => {
    expect(source).toMatch(new RegExp(`\\bt\\('${key}'[,)]`));
    expect(en.AppAssignmentDetailPage[key]).toBeTruthy();
    expect(pl.AppAssignmentDetailPage[key]).toBeTruthy();
    expect(pl.AppAssignmentDetailPage[key]).not.toBe(en.AppAssignmentDetailPage[key]);
  });

  it('keeps no English literal from the report in the markup', () => {
    // JSX text: whatever follows the end of a tag, on the same line or on the next one.
    expect(source).not.toMatch(/>\s*(Scheduled|Closed|Opens|This assignment is closed)\b/);
  });
});
