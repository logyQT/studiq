'use client';

import { useTranslations } from 'next-intl';
import { BREADCRUMB_ROUTES } from '@/config/breadcrumbs';
import { useBreadcrumbContext } from '@/components/providers/BreadcrumbProvider';
import type { Crumb } from '@/components/layout/breadcrumbs';

function matchRoute(pathname: string, routeKey: string): boolean {
  if (pathname === routeKey) return true;

  const routeParts = routeKey.split('/');
  const pathParts = pathname.split('/');
  if (routeParts.length !== pathParts.length) return false;

  return routeParts.every((part, i) => part.startsWith('[') || part === pathParts[i]);
}

function findLongestMatch(pathname: string): string[] {
  const matches: string[] = [];
  const parts = pathname.split('/');

  for (let len = 1; len <= parts.length; len++) {
    const candidate = parts.slice(0, len).join('/');
    for (const routeKey of Object.keys(BREADCRUMB_ROUTES)) {
      if (matchRoute(candidate, routeKey)) {
        matches.push(routeKey);
        break;
      }
    }
  }

  return matches;
}

function resolveHref(pathname: string, entryHref?: string): string {
  if (entryHref) return entryHref;
  const parts = pathname.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

export function useBreadcrumbs(pathname: string): Crumb[] {
  const { dynamicSegments } = useBreadcrumbContext();

  const tDashboard = useTranslations('DashboardLayout');
  const tAppFlashcards = useTranslations('AppFlashcardsPage');
  const tEduFlashcards = useTranslations('EduFlashcardsPage');
  const tSession = useTranslations('AppFlashcardSessionPage');
  const tDeckView = useTranslations('AppFlashcardDeckViewPage');
  const tStats = useTranslations('AppFlashcardStatsPage');

  const translators: Record<string, (key: string) => string> = {
    DashboardLayout: (key) => tDashboard(key),
    AppFlashcardsPage: (key) => tAppFlashcards(key),
    EduFlashcardsPage: (key) => tEduFlashcards(key),
    AppFlashcardSessionPage: (key) => tSession(key),
    AppFlashcardDeckViewPage: (key) => tDeckView(key),
    AppFlashcardStatsPage: (key) => tStats(key),
  };

  const matchedRoutes = findLongestMatch(pathname);
  const crumbs: Crumb[] = [];

  for (const routeKey of matchedRoutes) {
    const entry = BREADCRUMB_ROUTES[routeKey];
    if (!entry) continue;

    const translate = entry.namespace ? translators[entry.namespace] : null;
    const isDynamicRoute = routeKey.includes('[');

    const href = isDynamicRoute ? resolveHref(pathname, entry.href) : routeKey;
    if (crumbs.length > 0 && crumbs[crumbs.length - 1].href === href) continue;

    crumbs.push({
      label: translate ? translate(entry.labelKey) : entry.labelKey,
      href,
    });
  }

  if (dynamicSegments.length > 0) {
    crumbs.push(...dynamicSegments);
  }

  return crumbs;
}
