import fs from 'node:fs';
import path from 'node:path';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import { buildBreadcrumbs, ID_SEGMENT, OMITTED_PREFIXES, PATH_LABELS } from '@/lib/breadcrumbs';
import { describe, expect, it } from 'vitest';

const DECK_ID = 'ccf03248-3167-467e-b4bd-78b3c94457ba';
const ASSIGNMENT_ID = '5b0d1d6e-8a41-4f4e-9f6a-2d3c4b5a6e7f';
const ATTEMPT_ID = '9f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f';

type Messages = Record<string, unknown>;

function translate(messages: Messages) {
  return (key: string): string => {
    const value = key.split('.').reduce<unknown>((node, part) => {
      if (!node || typeof node !== 'object') return undefined;
      return (node as Messages)[part];
    }, messages);

    return typeof value === 'string' ? value : '';
  };
}

const t = translate(pl as Messages);

function crumbs(pathname: string, names: Record<string, string> = {}) {
  return buildBreadcrumbs({ pathname, names, t });
}

function labels(pathname: string, names: Record<string, string> = {}) {
  return crumbs(pathname, names).map((crumb) => crumb.label);
}

describe('buildBreadcrumbs', () => {
  it('localizes the educator flashcard route', () => {
    const trail = crumbs('/edu/flashcards');

    expect(trail.map((crumb) => crumb.label)).toEqual(['Panel Nauczyciela', 'Talie fiszek']);
    expect(trail[0]).toMatchObject({ href: '/edu', isCurrent: false });
    expect(trail[1]).toMatchObject({ href: null, isCurrent: true });
  });

  it('never renders the raw static URL segment', () => {
    expect(labels('/edu/questions')).toEqual(['Panel Nauczyciela', 'Pytania']);
    expect(labels('/edu/topics')).toEqual(['Panel Nauczyciela', 'Tematy fiszek']);
    expect(labels('/edu/assignments')).toEqual(['Panel Nauczyciela', 'Kartkówki']);
    expect(labels('/edu/stats/data')).toEqual(['Panel Nauczyciela', 'Statystyki', 'Treści']);
  });

  it('renders group prefixes without a page of their own as plain text', () => {
    const trail = crumbs('/edu/stats/data');

    expect(trail[1]).toMatchObject({ label: 'Statystyki', href: null, isCurrent: false });
  });

  it('omits a dynamic UUID when the page publishes no name', () => {
    const trail = crumbs(`/edu/flashcards/${DECK_ID}`);

    expect(trail.map((crumb) => crumb.label)).toEqual(['Panel Nauczyciela', 'Talie fiszek']);
    expect(trail[1]).toMatchObject({ isCurrent: true, href: null });
    expect(trail.some((crumb) => ID_SEGMENT.test(crumb.label))).toBe(false);
    expect(trail.some((crumb) => crumb.label.includes(DECK_ID))).toBe(false);
  });

  it('uses the published entity name as the leaf', () => {
    const trail = crumbs(`/edu/flashcards/${DECK_ID}`, { [DECK_ID]: 'Biologia — komórka' });

    expect(trail.map((crumb) => crumb.label)).toEqual([
      'Panel Nauczyciela',
      'Talie fiszek',
      'Biologia — komórka',
    ]);
    expect(trail[2]).toMatchObject({ isCurrent: true, href: null });
  });

  it('keeps nested static routes after a dynamic segment', () => {
    const trail = crumbs(`/edu/assignments/${ASSIGNMENT_ID}/results`, {
      [ASSIGNMENT_ID]: 'Kartkówka 1',
    });

    expect(trail.map((crumb) => crumb.label)).toEqual([
      'Panel Nauczyciela',
      'Kartkówki',
      'Kartkówka 1',
      'Wyniki',
    ]);
    expect(trail.find((crumb) => crumb.label === 'Kartkówka 1')?.href).toBe(
      `/edu/assignments/${ASSIGNMENT_ID}`,
    );
    expect(trail[3]).toMatchObject({ isCurrent: true, href: null });
  });

  it('labels quiz sessions and their review step', () => {
    expect(labels(`/app/study/session/quiz/${ATTEMPT_ID}`)).toEqual([
      'Moja Nauka',
      'Sesja testowa',
    ]);
    expect(labels(`/app/study/session/quiz/${ATTEMPT_ID}/review`)).toEqual([
      'Moja Nauka',
      'Sesja testowa',
      'Wyniki testu',
    ]);

    // `/app/study/session/quiz` has no page of its own (the `[type]` page only
    // accepts review|new|cram), so the intermediate crumb must not be a link.
    const trail = crumbs(`/app/study/session/quiz/${ATTEMPT_ID}/review`);
    expect(trail[1]).toMatchObject({ label: 'Sesja testowa', href: null, isCurrent: false });
    expect(trail[2]).toMatchObject({ label: 'Wyniki testu', isCurrent: true });
  });

  it('labels study modes and difficulty buckets', () => {
    expect(labels('/app/study/learn')).toEqual(['Moja Nauka', 'Ucz się']);
    expect(labels('/app/study/session/review')).toEqual(['Moja Nauka', 'Powtórka']);
    expect(labels('/edu/flashcards/stats/difficulty/easy')).toEqual([
      'Panel Nauczyciela',
      'Talie fiszek',
      'Statystyki fiszek',
      'Poziom trudności',
      'Łatwe fiszki',
    ]);
  });

  it('drops unknown static segments instead of falling back to the raw URL', () => {
    expect(labels('/edu/some-unknown-page')).toEqual(['Panel Nauczyciela']);
  });

  it('resolves every route-map key in both locales', () => {
    for (const [locale, messages] of Object.entries({ pl, en })) {
      const localeT = translate(messages as Messages);

      for (const [route, entry] of Object.entries(PATH_LABELS)) {
        expect(localeT(entry.labelKey), `${locale}: ${route} -> ${entry.labelKey}`).not.toBe('');
      }
    }
  });
});

describe('route coverage', () => {
  const appRoot = path.join(process.cwd(), 'apps/web/src/app/(frontend)');

  function pageRoutes(area: string): string[] {
    const routes: string[] = [];

    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(target);
        else if (entry.name === 'page.tsx') {
          routes.push(`/${path.relative(appRoot, directory).split(path.sep).join('/')}`);
        }
      }
    };

    walk(path.join(appRoot, area));
    return routes;
  }

  /** Static prefixes of a route, with dynamic segments normalised to `*`. */
  function staticPrefixes(route: string): string[] {
    const walked: string[] = [];
    const prefixes: string[] = [];

    for (const segment of route.split('/').filter(Boolean)) {
      walked.push(segment);
      if (segment.startsWith('[')) continue;
      prefixes.push(`/${walked.map((part) => (part.startsWith('[') ? '*' : part)).join('/')}`);
    }

    return prefixes;
  }

  const registered = new Set(Object.keys(PATH_LABELS));
  const omitted = new Set<string>(OMITTED_PREFIXES);
  const dashboardRoutes = ['edu', 'app', 'manage'].flatMap(pageRoutes);

  /**
   * Literal URLs that are legitimately served by a *dynamic* page instead of a
   * literal page.tsx. Only add a route here after confirming the dynamic page
   * renders it; `link: false` prefixes must never be listed.
   *   - session/[type]: VALID_TYPES = review | new | cram   (NOT quiz)
   *   - difficulty/[bucket]: no validation, any bucket renders
   */
  const VIRTUAL_ROUTES = new Set([
    '/app/study/session/review',
    '/app/study/session/new',
    '/app/study/session/cram',
    '/edu/flashcards/stats/difficulty/easy',
    '/edu/flashcards/stats/difficulty/medium',
    '/edu/flashcards/stats/difficulty/hard',
    '/edu/flashcards/stats/difficulty/new',
  ]);

  /**
   * A literal segment must match a literal directory — a dynamic directory does
   * not count (that is why `/app/study/session/quiz` is caught). `*` must match
   * a single dynamic directory `[param]`; a catch-all `[...slug]` renders 404
   * for arbitrary ids and never counts.
   */
  function routeExists(pattern: string): boolean {
    const segments = pattern.split('/').filter(Boolean);

    return dashboardRoutes.some((route) => {
      const routeSegments = route.split('/').filter(Boolean);
      if (routeSegments.length !== segments.length) return false;

      return segments.every((segment, index) => {
        const routeSegment = routeSegments[index];
        if (segment === '*') return /^\[[^.[\]]+\]$/.test(routeSegment);

        return routeSegment === segment;
      });
    });
  }

  it('registers every static dashboard route prefix', () => {
    for (const area of ['edu', 'app', 'manage']) {
      for (const route of pageRoutes(area)) {
        for (const prefix of staticPrefixes(route)) {
          expect(
            registered.has(prefix) || omitted.has(prefix),
            `${prefix} (from ${route}) is missing from PATH_LABELS`,
          ).toBe(true);
        }
      }
    }
  });

  it('marks entries without a page of their own as non-links', () => {
    for (const [route, entry] of Object.entries(PATH_LABELS)) {
      const hasPage = routeExists(route) || VIRTUAL_ROUTES.has(route);

      if (entry.link === false) {
        expect(hasPage, `${route} is link:false but has a page`).toBe(false);
      } else {
        expect(hasPage, `${route} is linkable but has no page`).toBe(true);
      }
    }

    for (const route of VIRTUAL_ROUTES) expect(PATH_LABELS[route]).toBeDefined();
  });

  it('resolves every registered route from a concrete pathname', () => {
    for (const [route, entry] of Object.entries(PATH_LABELS)) {
      const pathname = route.replace(/\*/g, DECK_ID);

      expect(labels(pathname), `${route} -> ${entry.labelKey}`).toContain(t(entry.labelKey));
    }
  });
});
