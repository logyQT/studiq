import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #179 review: the "current plan" badge of the teacher plan list must be the effective plan
// (a seated teacher gets the seat plan, see getMyPlan), not profiles.personal_plan_key.

describe('/edu/upgrade current plan', () => {
  const page = readFileSync('apps/web/src/app/(frontend)/edu/upgrade/page.tsx', 'utf8');

  it('reads the effective plan', () => {
    expect(page).toContain("url: '/api/v1/me/plan'");
    expect(page).not.toContain('/api/v1/me/personal-plan');
  });
});
