import type { NavItem } from '@/components/nav-main';

export interface SidebarSection {
  label: string;
  items: NavItem[];
}

export interface SidebarGates {
  feature: (feature: string) => boolean;
  permission: (permission: string) => boolean;
}

/**
 * What the sidebar renders for one section list: an item with no gate always
 * shows, a `permission` item shows while `/permissions/me` carries that key (the
 * `group.read` the class routes enforce), a `feature` item while `/features/me`
 * carries its entitlement.
 *
 * The permission answer is "is the key in the map", not a scoped evaluation:
 * most keys are granted at `group` or `organization` scope, and a `group`-scope
 * row says yes to a class the caller teaches while a nav entry has no row to ask
 * about. A nav link must therefore follow the key, or a Teacher — who holds
 * `group.read`/`group.manage` at `group` scope — loses the entry to their own
 * class list.
 */
export function visibleNavItems(items: readonly NavItem[], gates: SidebarGates): NavItem[] {
  return items.filter(
    (item) =>
      (!item.feature || gates.feature(item.feature)) &&
      (!item.permission || gates.permission(item.permission)),
  );
}

/** The section list as rendered, with the unread reports count on the reports entry. */
export function sectionsWithBadge(
  sections: readonly SidebarSection[],
  items: (section: SidebarSection) => NavItem[],
  reportsUnread: number | undefined,
): SidebarSection[] {
  return sections.map((section) => ({
    ...section,
    items: items(section).map((item) =>
      item.href.endsWith('/reports') ? { ...item, badge: reportsUnread ?? 0 } : item,
    ),
  }));
}
