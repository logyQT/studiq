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

export function useBreadcrumbs(pathname: string): Crumb[] {
  const { dynamicSegments } = useBreadcrumbContext();

  const tDashboard = useTranslations('DashboardLayout');
  const tAppFlashcards = useTranslations('AppFlashcardsPage');
  const tEduFlashcards = useTranslations('EduFlashcardsPage');
  const tSession = useTranslations('AppFlashcardSessionPage');

  const translators: Record<string, (key: string) => string> = {
    DashboardLayout: (key) => tDashboard(key),
    AppFlashcardsPage: (key) => tAppFlashcards(key),
    EduFlashcardsPage: (key) => tEduFlashcards(key),
    AppFlashcardSessionPage: (key) => tSession(key),
  };

  const matchedRoutes = findLongestMatch(pathname);
  const crumbs: Crumb[] = [];

  for (const routeKey of matchedRoutes) {
    const entry = BREADCRUMB_ROUTES[routeKey];
    const translate = translators[entry.namespace];

    const isDynamicRoute = routeKey.includes('[');
    const isLastMatch = routeKey === matchedRoutes[matchedRoutes.length - 1];

    if (isDynamicRoute && isLastMatch) {
      crumbs.push({
        label: translate(entry.labelKey),
        href: entry.href ?? routeKey.replace(/\[[^\]]+\]/, ''),
      });
    } else {
      crumbs.push({
        label: translate(entry.labelKey),
        href: routeKey,
      });
    }
  }

  if (dynamicSegments.length > 0) {
    crumbs.push(...dynamicSegments);
  }

  return crumbs;
}
