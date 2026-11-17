import { AccountType } from '@studiq/authz';
import { describe, expect, it } from 'vitest';
import { dashboardHomeFor } from '@/lib/dashboard-home';

describe('dashboardHomeFor', () => {
  it('sends educators to the teacher dashboard', () => {
    expect(dashboardHomeFor(AccountType.EDUCATOR)).toBe('/edu');
  });

  it('sends managers to the manager dashboard', () => {
    expect(dashboardHomeFor(AccountType.MANAGER)).toBe('/manage');
  });

  it('falls back to the student dashboard for students and unknown or missing types', () => {
    expect(dashboardHomeFor(AccountType.STUDENT)).toBe('/app');
    expect(dashboardHomeFor(undefined)).toBe('/app');
    expect(dashboardHomeFor(null)).toBe('/app');
    expect(dashboardHomeFor('something-else')).toBe('/app');
  });
});
