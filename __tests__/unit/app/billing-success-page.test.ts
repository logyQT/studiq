import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The poll drops the authority caches through the function its caller gives it (#799). The
 * type only requires some function, so this checks that the page passes the real one (#1542).
 *
 * This is a source check, not a render test: the page needs the router, the auth provider and
 * a query client, which the unit environment cannot render it under.
 */
const PAGE = path.join(process.cwd(), 'apps/web/src/app/(frontend)/billing/success/page.tsx');

describe('billing success page', () => {
  it('gives the activation poll the shared authority invalidation', () => {
    const source = readFileSync(PAGE, 'utf8');
    const start = source.indexOf('await pollBillingActivation({');
    expect(start, 'the page runs the activation poll').toBeGreaterThan(-1);
    const call = source.slice(start, source.indexOf('});', start));

    expect(call).toContain('invalidateAuthority: () => invalidateAuthority(queryClient),');
    expect(source).toContain("import { invalidateAuthority } from '@/lib/query-cache';");
  });
});
