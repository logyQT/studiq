import { Permission, type PermissionScope } from '@studiq/authz';
import { describe, expect, it } from 'vitest';
import { currentSections } from '@/components/app-sidebar';
import type { NavItem } from '@/components/nav-main';
import { permissionScope } from '@/hooks/use-permission';
import { sectionsWithBadge, visibleNavItems } from '@/lib/sidebar-nav';

// EDU-GRP-05's walk found the „Grupy” entry missing for an educator whose role
// held `group.read`: the entry used `usePermission()` without a resource, which
// called `evaluateScope` on every key, so a `group`-scope row (a Teacher's
// `group.read`) never matched and the page had no link at all. The nav gate is
// now the key's presence in `/me/permissions` — the same map the API is enforced
// from — and this file pins the gate's rules (any-of, feature+permission, no
// gate) plus the sections the sidebar derives from them.

/** The `/edu` or `/manage` sidebar as `AppSidebar` renders it for one map. */
function sidebar(pathname: string, permissions: Record<string, PermissionScope>) {
  return sectionsWithBadge(
    currentSections(pathname),
    (section) =>
      visibleNavItems(section.items, {
        feature: () => true,
        permission: (key) => permissionScope(permissions, key) !== null,
      }),
    0,
  );
}

const handlers = (sections: ReturnType<typeof sidebar>) =>
  sections.flatMap((section) => section.items.map((item) => item.href));

/** Both gates held constant, for the entries that declare an entitlement. */
const gatesFor = (feature: boolean, permission: boolean) => ({
  feature: () => feature,
  permission: () => permission,
});

describe('the sidebar permission gate', () => {
  it('reads the key the API answers, at every scope', () => {
    // The three scopes a role row can carry, plus the two that must not pass.
    for (const scope of ['own', 'group', 'organization'] as const) {
      expect(permissionScope({ 'group.read': scope }, 'group.read')).toBe(scope);
    }
    expect(permissionScope({}, 'group.read')).toBeNull();
    expect(permissionScope(undefined, 'group.read')).toBeNull();
  });

  it('shows an any-of entry when one of its keys is held', () => {
    const item: NavItem = {
      titleKey: 'manage_members',
      href: '/manage/members',
      permissions: [
        Permission.ORG_MEMBER_MANAGE,
        Permission.GROUP_MANAGE,
        Permission.GROUP_INVITE,
        Permission.ORG_SEAT_MANAGE,
      ],
    };

    // Each authority alone is enough: the roster read is one capability with
    // four readers (D25), so requiring all four would hide it from every one.
    for (const key of item.permissions ?? []) {
      const shown = visibleNavItems([item], {
        feature: () => false,
        permission: (candidate) => candidate === key,
      });
      expect(shown, `${key} alone shows the entry`).toHaveLength(1);
    }

    // None of them: absent means deny, never a flash.
    expect(visibleNavItems([item], { feature: () => false, permission: () => false })).toEqual([]);
  });

  it('requires both the entitlement and one permission when an entry declares both', () => {
    const item: NavItem = {
      titleKey: 'ai_chat',
      href: '/edu/ai',
      feature: 'ai.chat',
      permissions: [Permission.QUIZ_READ],
    };

    expect(visibleNavItems([item], gatesFor(true, true))).toHaveLength(1);
    expect(visibleNavItems([item], gatesFor(true, false))).toEqual([]);
    expect(visibleNavItems([item], gatesFor(false, true))).toEqual([]);
    expect(visibleNavItems([item], gatesFor(false, false))).toEqual([]);
  });

  it('always shows an entry that declares no gate', () => {
    const item: NavItem = { titleKey: 'manage_overview', href: '/manage' };
    expect(visibleNavItems([item], { feature: () => false, permission: () => false })).toEqual([
      item,
    ]);
  });

  it('shows „Grupy” to every holder of group.read, whatever the scope', () => {
    // The regression: a `group`-scope row (a Teacher of the class) reached no surface.
    for (const scope of ['own', 'group', 'organization'] as const) {
      const hrefs = handlers(sidebar('/edu', { 'group.read': scope }));
      expect(hrefs, `group.read at ${scope}`).toContain('/edu/groups');
    }
  });

  it('hides „Grupy” from a caller whose map has no group.read', () => {
    // A role without the class key: the rest of its map does not carry it forward.
    const withoutRead = sidebar('/edu', { 'deck.read': 'group', 'flashcard.read': 'group' });
    expect(handlers(withoutRead)).not.toContain('/edu/groups');

    // And before `/me/permissions` resolves: absent means deny, never a flash.
    expect(handlers(sidebar('/edu', {}))).not.toContain('/edu/groups');
  });

  it('gates every /edu content and statistics entry on its own read key', () => {
    const nothingHeld = handlers(sidebar('/edu', {}));
    // Ungated entries stay (the overview and the report inbox are membership);
    // the assistant entry is `feature`-gated, not permission-gated, so this
    // helper's always-on entitlement leaves it visible.
    expect(nothingHeld).toEqual(['/edu', '/edu/ai', '/edu/reports']);

    const reads: [string, string][] = [
      ['/edu/flashcards', Permission.DECK_READ],
      ['/edu/topics', Permission.TOPIC_READ],
      ['/edu/questions', Permission.QUESTION_BANK_READ],
      ['/edu/quizzes', Permission.QUIZ_READ],
      ['/edu/assignments', Permission.ASSIGNMENT_READ],
      ['/edu/groups', Permission.GROUP_READ],
      ['/edu/stats/data', Permission.STATS_READ],
      ['/edu/stats/results', Permission.STATS_READ],
      ['/edu/stats/activity', Permission.STATS_READ],
    ];
    for (const [href, key] of reads) {
      expect(handlers(sidebar('/edu', { [key]: 'group' })), `${key} → ${href}`).toContain(href);
    }
  });

  it('offers a Member the overview and the class list, and no administration entry', () => {
    // The bookmarked-URL shape: a Member keeps `/manage` itself (membership) and
    // `group.read` opens the class list, but the roster/invites/roles/seats/
    // settings entries stay hidden — the page's own reads are the boundary.
    const member = sidebar('/manage', {
      'deck.read': 'group',
      'quiz.read': 'group',
      'group.read': 'group',
      'stats.read': 'own',
    });
    expect(handlers(member)).toEqual(['/manage', '/manage/groups']);
  });

  it('offers an Admin every /manage entry', () => {
    const admin = sidebar('/manage', {
      'org.member.manage': 'organization',
      'org.invitation.manage': 'organization',
      'group.manage': 'organization',
      'group.read': 'organization',
      'org.report.manage': 'organization',
      'org.role.manage': 'organization',
      'org.seat.manage': 'organization',
      'org.billing.manage': 'organization',
      'org.settings.manage': 'organization',
    });
    expect(handlers(admin)).toEqual([
      '/manage',
      '/manage/members',
      '/manage/invites',
      '/manage/groups',
      '/manage/reports',
      '/manage/roles',
      '/manage/seats',
      '/manage/settings',
    ]);
  });

  it('leaves other dashboard areas without the class entry', () => {
    expect(handlers(sidebar('/edu', { 'group.read': 'group' }))).toContain('/edu/groups');
    const manageHrefs = handlers(sidebar('/manage', { 'group.read': 'group' }));
    expect(manageHrefs).toContain('/manage/groups');
    expect(manageHrefs).not.toContain('/edu/groups');
    expect(currentSections('/marketing')).toEqual([]);
  });
});
