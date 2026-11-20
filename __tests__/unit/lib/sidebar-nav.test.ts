import { describe, expect, it } from 'vitest';
import type { PermissionScope } from '@studiq/authz';
import { currentSections } from '@/components/app-sidebar';
import { permissionScope } from '@/hooks/use-permission';
import { sectionsWithBadge, visibleNavItems } from '@/lib/sidebar-nav';

// EDU-GRP-05's walk found the „Grupy” entry missing for an educator whose role
// held `group.read`: the entry used `usePermission()` without a resource, which
// called `evaluateScope` on every key, so a `group`-scope row (a Teacher's
// `group.read`) never matched and the page had no link at all. The nav gate is
// now the key's presence in `/permissions/me` — the same map
// `/api/v1/organization/groups` is enforced from — and this file pins both
// halves: the map lookup, and the sections the sidebar derives from it.

/** The `/edu` sidebar as `AppSidebar` renders it for one `/permissions/me` map. */
function eduSidebar(permissions: Record<string, PermissionScope>) {
  return sectionsWithBadge(
    currentSections('/edu'),
    (section) =>
      visibleNavItems(section.items, {
        feature: () => true,
        permission: (key) => permissionScope(permissions, key) !== null,
      }),
    0,
  );
}

const handlers = (sections: ReturnType<typeof eduSidebar>) =>
  sections.flatMap((section) => section.items.map((item) => item.href));

describe('the sidebar permission gate', () => {
  it('reads the key the API answers, at every scope', () => {
    // The three scopes a role row can carry, plus the two that must not pass.
    for (const scope of ['own', 'group', 'organization'] as const) {
      expect(permissionScope({ 'group.read': scope }, 'group.read')).toBe(scope);
    }
    expect(permissionScope({}, 'group.read')).toBeNull();
    expect(permissionScope(undefined, 'group.read')).toBeNull();
  });

  it('shows „Grupy” to every holder of group.read, whatever the scope', () => {
    // The regression: a `group`-scope row (a Teacher of the class) reached no surface.
    for (const scope of ['own', 'group', 'organization'] as const) {
      const hrefs = handlers(eduSidebar({ 'group.read': scope }));
      expect(hrefs, `group.read at ${scope}`).toContain('/edu/groups');
    }
  });

  it('hides „Grupy” from a caller whose map has no group.read', () => {
    // A role without the class key: the rest of its map does not carry it forward.
    const withoutRead = eduSidebar({ 'deck.read': 'group', 'flashcard.read': 'group' });
    expect(handlers(withoutRead)).not.toContain('/edu/groups');

    // And before `/permissions/me` resolves: absent means deny, never a flash.
    expect(handlers(eduSidebar({}))).not.toContain('/edu/groups');
  });

  it('keeps the rest of the /edu nav ungated, and gates the class entry alone', () => {
    const nothingHeld = sectionsWithBadge(
      currentSections('/edu'),
      (section) =>
        visibleNavItems(section.items, { feature: () => false, permission: () => false }),
      0,
    );
    const hrefs = handlers(nothingHeld);
    expect(hrefs).toEqual(
      expect.arrayContaining(['/edu', '/edu/flashcards', '/edu/topics', '/edu/questions']),
    );
    expect(hrefs).not.toContain('/edu/groups');
    expect(hrefs).not.toContain('/edu/ai');

    // Every gated entry the list declares is exactly the two those gates remove.
    const gated = currentSections('/edu')
      .flatMap((section) => section.items)
      .filter((item) => item.permission || item.feature)
      .map((item) => item.href);
    expect(gated.toSorted()).toEqual(['/edu/ai', '/edu/groups']);
  });

  it('leaves other dashboard areas without the class entry', () => {
    expect(handlers(eduSidebar({ 'group.read': 'group' }))).toContain('/edu/groups');
    const manageHrefs = sectionsWithBadge(
      currentSections('/manage'),
      (section) => section.items,
      0,
    ).flatMap((section) => section.items.map((item) => item.href));
    expect(manageHrefs).toContain('/manage/groups');
    expect(manageHrefs).not.toContain('/edu/groups');
    expect(currentSections('/marketing')).toEqual([]);
  });
});
