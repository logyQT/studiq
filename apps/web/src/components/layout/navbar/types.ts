/**
 * A header nav destination.
 *
 * `namespace` exists because the header shows two kinds of link: public ones whose
 * labels live in `Navbar`, and dashboard ones whose labels live in `DashboardLayout`
 * — the namespace the sidebar translates them with. Reading the dashboard links
 * from the same keys as the sidebar is what stops the header drifting from it.
 */
export interface NavLink {
  labelKey: string;
  href: string;
  namespace?: 'Navbar' | 'DashboardLayout';
}
