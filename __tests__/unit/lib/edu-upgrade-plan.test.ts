import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #179 review: the "current plan" badge of the teacher plan list must be the effective plan
// (a seated teacher gets the seat plan, see getMyPlan), not profiles.personal_plan_key.
// The action gating reads the personal plan: these rows sell that plan, and a
// seat plan is not the reader's own subscription.

describe('/edu/upgrade plan reads', () => {
  const page = readFileSync('apps/web/src/app/(frontend)/edu/upgrade/page.tsx', 'utf8');

  it('keeps the effective plan for the badge and reads the personal plan for actions', () => {
    expect(page).toContain("url: '/api/v1/me/plan'");
    expect(page).toContain("url: '/api/v1/me/personal-plan'");
  });
});
