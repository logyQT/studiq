import { evaluateScope, type ResourceAccess } from '@studiq/authz';
import { describe, expect, it } from 'vitest';

/**
 * The pure scope ladder (`evaluateScope`) as the client and `evaluate()` read it.
 * `group` is pinned to "not granted": a content write cannot hold it (#961), and
 * this helper has no membership data to answer it, so it must never fall through
 * to the `organization` arm.
 */

const CALLER = 'user-1';

const someoneElsesResource: ResourceAccess = {
  createdBy: 'user-2',
  orgId: 'org-1',
  activeOrgId: 'org-1',
};

describe('evaluateScope', () => {
  it('own scope passes for the creator', () => {
    expect(evaluateScope('own', CALLER, { ...someoneElsesResource, createdBy: CALLER })).toBe(true);
  });

  it('own scope refuses a caller who did not create the resource', () => {
    expect(evaluateScope('own', CALLER, someoneElsesResource)).toBe(false);
  });

  it('group scope is not a grant in the pure helper', () => {
    // Same active org and same org row: only a fall-through to the
    // `organization` arm could answer true here.
    expect(evaluateScope('group', CALLER, someoneElsesResource)).toBe(false);
  });

  it('organization scope follows the active org', () => {
    expect(evaluateScope('organization', CALLER, someoneElsesResource)).toBe(true);
    expect(
      evaluateScope('organization', CALLER, {
        ...someoneElsesResource,
        orgId: 'org-2',
      }),
    ).toBe(false);
    expect(
      evaluateScope('organization', CALLER, {
        ...someoneElsesResource,
        activeOrgId: null,
      }),
    ).toBe(false);
  });

  it('a null scope and a missing active org deny', () => {
    expect(evaluateScope(null, CALLER, someoneElsesResource)).toBe(false);
    expect(evaluateScope(undefined, CALLER, someoneElsesResource)).toBe(false);
    expect(
      evaluateScope('organization', CALLER, {
        ...someoneElsesResource,
        activeOrgId: null,
      }),
    ).toBe(false);
  });
});
