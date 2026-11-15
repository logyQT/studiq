import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditAssignmentClient from '@/app/(frontend)/edu/assignments/[id]/edit/edit-client';
import pl from '@/i18n/messages/pl.json';

/**
 * #1225 — the edit page kept its loading branch on `!assignment`, so a 404 (the
 * query settles with no data) left one pulse bar on screen forever. The page has
 * to leave the loading path on a failed query and offer a way back.
 */
const query = vi.hoisted(() => ({
  id: '00000000-0000-4000-8000-000000000099',
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: query.id }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/hooks/use-api', () => ({
  useApiQuery: () => query,
  useApiMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// The breadcrumb label is published through a provider this suite does not mount.
vi.mock('@/hooks/use-breadcrumbs', () => ({ useBreadcrumbLabel: () => {} }));

const locale = 'pl';
const detail = createTranslator({ locale, messages: pl, namespace: 'EduAssignmentDetailPage' });

function render(element: ReactNode) {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: pl, timeZone: 'UTC' }, element),
  );
}

const assignment = {
  id: query.id,
  title: 'Sprawdzian z algebry',
  description: null,
  deadline: null,
  time_limit_min: null,
  shuffle_questions: true,
  shuffle_answers: true,
  show_results: false,
  max_attempts: 1,
  passing_score: null,
};

describe('assignment edit page for a missing id (#1225)', () => {
  beforeEach(() => {
    query.data = undefined;
    query.isLoading = false;
  });

  it('renders the not-found state instead of the skeleton once the query settles empty', () => {
    const html = render(createElement(EditAssignmentClient));

    expect(html).toContain(detail('not_found'));
    expect(html).not.toContain('animate-pulse');
  });

  it('offers a link back to the assignment list', () => {
    const html = render(createElement(EditAssignmentClient));

    expect(html).toContain('href="/edu/assignments"');
    expect(html).toContain(detail('back'));
  });

  it('still holds the skeleton while the query is in flight', () => {
    query.isLoading = true;

    const html = render(createElement(EditAssignmentClient));

    expect(html).toContain('animate-pulse');
    expect(html).not.toContain(detail('not_found'));
  });

  it('renders the prefilled form when the assignment resolves', () => {
    query.data = assignment;

    const html = render(createElement(EditAssignmentClient));

    expect(html).toContain(assignment.title);
    expect(html).not.toContain(detail('not_found'));
  });
});
