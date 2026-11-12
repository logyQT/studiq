import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #1125: a hard-loaded `/manage` deep link rendered `Nie udało się wczytać listy`
// with `0 łącznie` until the user pressed "try again".
//
// `active_org_id` is a server-only hint (`withAuth`), not part of the session, so a
// fresh login has none: `useOrgs()` writes it with one `/api/v1/me/orgs/switch`
// request after `/me/orgs` resolves. Every org-scoped endpoint answers FORBIDDEN
// while the hint is missing (`!ctx.activeOrgId` in the organization-member, group,
// org-role and seat services), and the manage screens fired their list request on
// mount — before that switch had landed.
//
// The gate is wired in client components and this suite has no component harness
// (there is no @testing-library/react, and `react-dom/server` never runs effects),
// so the wiring is pinned at the source level, the same contract style
// `dashboard-error-states.test.ts` uses for #655. `org-scoped-load.test.ts` covers
// the predicate itself.

const read = (path: string) => readFileSync(path, 'utf8');

const HOOK = 'apps/web/src/hooks/use-org-scoped-load.ts';

interface OrgScopedScreen {
  /** A request the screen used to send before the active org existed. */
  readonly fetch: string;
  /** The `load`-style callback its mount effect used to run. */
  readonly loader: string;
  readonly path: string;
}

const ORG_SCOPED_SCREENS: readonly OrgScopedScreen[] = [
  {
    path: 'apps/web/src/app/(frontend)/manage/members/page.tsx',
    fetch: '/api/v1/organization/members',
    loader: 'load',
  },
  {
    path: 'apps/web/src/app/(frontend)/manage/invites/page.tsx',
    fetch: '/api/v1/organization/invites',
    loader: 'fetchInvitations',
  },
  {
    path: 'apps/web/src/components/groups/group-management-screen.tsx',
    fetch: '/api/v1/organization/groups',
    loader: 'load',
  },
  {
    path: 'apps/web/src/app/(frontend)/manage/roles/page.tsx',
    fetch: '/api/v1/organization/roles',
    loader: 'load',
  },
  {
    path: 'apps/web/src/app/(frontend)/manage/seats/page.tsx',
    fetch: '/api/v1/organization/seats/pools',
    loader: 'loadData',
  },
];

describe('the org gate itself (#1125)', () => {
  const hook = read(HOOK);

  it('holds the first load until there is an active org', () => {
    expect(hook).toContain('if (!canLoadOrgScoped(activeOrgId)) return;');
  });

  it('reloads when the active org changes', () => {
    // A switch must swap the rows, not leave the previous org's list on screen.
    expect(hook).toContain('}, [activeOrgId, load]);');
  });
});

describe('org-scoped manage lists wait for the active org (#1125)', () => {
  it.each(ORG_SCOPED_SCREENS)('$path loads $fetch through the gate', ({ path, fetch, loader }) => {
    const source = read(path);

    expect(source).toContain(fetch);
    expect(source).toContain(`useOrgScopedLoad(${loader});`);
  });

  it.each(ORG_SCOPED_SCREENS)(
    '$path has no effect that fires $loader on mount',
    ({ path, loader }) => {
      // `useEffect(() => load(), [load])` ran on mount, while `activeOrg` was still
      // null after a fresh login — the request that came back 403.
      expect(read(path)).not.toMatch(new RegExp(String.raw`\}, \[${loader}\]\)`));
    },
  );
});
