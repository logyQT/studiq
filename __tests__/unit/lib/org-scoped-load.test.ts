import { describe, expect, it } from 'vitest';
import { canLoadOrgScoped } from '@/lib/org-scoped-load';

const ORG_ID = '00000000-0000-4000-8000-000000000001';

describe('canLoadOrgScoped', () => {
  it('keeps the first fetch disarmed while the active org is unresolved', () => {
    // A cold `/manage/*` load reaches the page before `['orgs']` has data.
    expect(canLoadOrgScoped(undefined)).toBe(false);
    expect(canLoadOrgScoped(null)).toBe(false);
  });

  it('arms the fetch once the active org resolved', () => {
    expect(canLoadOrgScoped(ORG_ID)).toBe(true);
  });
});
