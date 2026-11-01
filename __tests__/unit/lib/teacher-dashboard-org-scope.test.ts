import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #654 review, operator decision A2: the teacher dashboard shows only the active organization's
// activity. The rules live in SQL and in a few components; these guards keep them from drifting.

const read = (path: string) => readFileSync(path, 'utf8');
const stamp = read('supabase/migrations/20261028100000_activity_organization.sql');
const rpcs = read('supabase/migrations/20261028100100_teacher_dashboard_rpcs.sql');
const schema = read('supabase/schemas/99_rpc_functions.sql');

describe('organization stamp of learner activity', () => {
  it('adds a nullable, indexed organization to attempts and reviews', () => {
    for (const table of ['quiz_attempts', 'flashcard_practice']) {
      expect(stamp).toContain(`ALTER TABLE public.${table}`);
    }
    const columns =
      stamp.split('ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES').length - 1;
    expect(columns).toBe(2);
    expect(stamp).toContain('ON DELETE SET NULL');
    expect(stamp).toContain('idx_quiz_attempts_organization');
    expect(stamp).toContain('idx_flashcard_practice_organization');
  });

  it('backfills assignment attempts from the assignment and leaves the rest NULL', () => {
    expect(stamp).toContain('SET organization_id = ta.organization_id');
    expect(stamp).toContain('WHERE qa.assignment_id = ta.id');
  });

  it('stamps from the owning resource, not the caller, and never from personal resources', () => {
    expect(stamp).toContain("f.visibility = 'group'");
    expect(stamp).toContain("q.visibility <> 'group'");
    expect(stamp).not.toContain('active_org');
    expect(stamp).not.toContain('auth.uid()');
  });

  it('stamps on every write path with triggers', () => {
    for (const trigger of [
      'quiz_attempts_stamp_organization',
      'quiz_attempt_questions_stamp_organization',
      'flashcard_practice_stamp_organization',
    ]) {
      expect(stamp).toContain(`CREATE TRIGGER ${trigger}`);
    }
  });

  it('recomputes the practice stamp and clears it when the snapshot is mixed', () => {
    for (const copy of [stamp, read('supabase/schemas/68_activity_organization.sql')]) {
      expect(copy).toContain('THEN MIN(q.organization_id::text)::uuid');
      expect(copy).toContain('ELSE NULL');
    }
  });

  it('the declarative schema has the columns and the stamping functions', () => {
    expect(read('supabase/schemas/39_quiz_attempts.sql')).toContain('organization_id');
    expect(read('supabase/schemas/45_flashcard_practice.sql')).toContain('organization_id');
    const functions = read('supabase/schemas/68_activity_organization.sql');
    expect(functions).toContain('stamp_quiz_attempt_organization');
    expect(functions).toContain('stamp_practice_attempt_organization');
    expect(functions).toContain('stamp_flashcard_practice_organization');
  });
});

describe('dashboard aggregates', () => {
  it('filter both attempts and reviews on the organization', () => {
    expect(rpcs.match(/qa\.organization_id = p_organization_id/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(rpcs).toContain('fp.organization_id = p_organization_id');
  });

  it('count each learner and each attempt once for the totals', () => {
    expect(rpcs).toContain("'students', (SELECT COUNT(*) FROM learner_set)");
    expect(rpcs).toContain("'completedAttempts', (SELECT COUNT(*) FROM attempt_rows)");
  });

  it('keep submitted-but-ungraded assignment attempts out of the average', () => {
    expect(rpcs).toContain('AVG(ar.pct) FILTER (WHERE NOT ar.awaiting)');
    expect(rpcs).toContain("'awaitingGrade'");
  });

  it('wait for a mark when an open answer or an open assignment question does', () => {
    for (const copy of [rpcs, schema]) {
      expect(copy).toContain('FROM public.assignment_questions aq');
      expect(copy).toContain("CASE WHEN sa.text_answer IS NOT NULL THEN 'open' END");
      expect(copy).not.toContain('open_answers AS (');
    }
  });

  it('the declarative copy is the same function text', () => {
    expect(schema).toContain('AVG(ar.pct) FILTER (WHERE NOT ar.awaiting)');
    expect(schema).toContain('qa.organization_id = p_organization_id');
    expect(schema).not.toMatch(/^\$;$/m);
    expect(schema).not.toMatch(/^AS \$$/m);
  });

  it('never excerpts a reported question outside the reader scope', () => {
    // #654 review: `question_reports` RLS lets any member report a known question id, so the
    // SECURITY DEFINER feed must not read the excerpt of a question the caller cannot read.
    for (const copy of [rpcs, schema]) {
      expect(copy).toContain(
        'AND (q.created_by = p_user_id OR q.organization_id = p_organization_id)',
      );
      expect(copy).not.toContain('LEFT JOIN public.questions q ON q.id = qr.question_id');
      // ... nor surface a client-chosen reporter id as a foreign user's name.
      expect(copy).toContain("auth.role() = 'service_role'");
      expect(copy).toContain(
        'OR p.id IN (SELECT c.user_id FROM public.rls_caller_org_user_ids() c)',
      );
      expect(copy).not.toContain('LEFT JOIN public.profiles p ON p.id = n.person_id');
    }
  });
});

describe('dashboard screen', () => {
  const page = read('apps/web/src/app/(frontend)/edu/page.tsx');

  it('takes the totals from the aggregate, never the sum of the rows', () => {
    expect(page).toContain('groups?.totals.students');
    expect(page).not.toMatch(/reduce\(\(sum, g\) => sum \+ g\.students/);
  });

  it('shows an error with a retry for every query instead of an empty dashboard', () => {
    for (const handler of ['refetchStats', 'refetchGroups', 'refetchFeed']) {
      expect(page).toContain(`${handler}()`);
    }
  });

  it.each(['group-performance-card', 'activity-feed-card', 'problem-questions-card'])(
    '%s has an error branch and a heading',
    (name) => {
      const card = read(`apps/web/src/components/edu/dashboard/${name}.tsx`);
      expect(card).toContain('<CardError onRetry={onRetry} />');
      expect(card).toContain('role="heading" aria-level={2}');
    },
  );

  it('labels the flashcard column as accuracy and says "no data" in words', () => {
    const card = read('apps/web/src/components/edu/dashboard/group-performance-card.tsx');
    expect(card).toContain("t('col_flashcard_accuracy')");
    expect(card).not.toContain("t('col_flashcards')");
    expect(card).toContain("t('no_data')");
    expect(card).not.toContain("'—'");
  });

  it.each(['pl', 'en'])('%s has the new strings', (locale) => {
    const messages = JSON.parse(read(`apps/web/src/i18n/messages/${locale}.json`));
    for (const key of [
      'col_flashcard_accuracy',
      'no_data',
      'awaiting_grade',
      'load_error',
      'retry',
    ]) {
      expect(messages.EduOverviewPage[key], key).toBeTruthy();
    }
  });
});

describe('review round 2 (#654)', () => {
  it('the stamp is authoritative: recomputed on insert, a client cannot move it', () => {
    expect(stamp).toContain('BEFORE INSERT OR UPDATE OF organization_id ON public.quiz_attempts');
    expect(stamp).toContain(
      'BEFORE INSERT OR UPDATE OF organization_id ON public.flashcard_practice',
    );
    expect(stamp).toContain('public.activity_stamp_client_write()');
    expect(stamp).toContain("COALESCE(auth.role(), '') IN ('authenticated', 'anon')");
  });

  it('the feed only shows assignments of the asked organization and never the raw assignment id', () => {
    expect(rpcs).toContain(
      'ON ta.id = qa.assignment_id AND ta.organization_id = p_organization_id',
    );
    expect(rpcs).toContain('ta.id AS assignment_id');
    expect(rpcs).not.toContain('qa.assignment_id AS assignment_id');
  });

  it('names a practice quiz after its bank', () => {
    expect(rpcs).toContain("COALESCE(ta.title, qa.config->>'title', qb.name) AS title");
  });

  it('the declarative copies follow', () => {
    expect(schema).toContain(
      'ON ta.id = qa.assignment_id AND ta.organization_id = p_organization_id',
    );
    const functions = read('supabase/schemas/68_activity_organization.sql');
    expect(functions).toContain('activity_stamp_client_write');
    expect(functions).toContain('BEFORE INSERT OR UPDATE OF organization_id');
  });

  it('a question answered fewer than three times is no question to review', () => {
    const service = read('packages/server/src/services/stats.service.ts');
    const card = read('apps/web/src/components/edu/dashboard/problem-questions-card.tsx');
    expect(service).toContain('question.totalAnswers >= MIN_PROBLEM_QUESTION_ANSWERS');
    expect(card).toContain('question.totalAnswers >= MIN_PROBLEM_QUESTION_ANSWERS');
  });

  it('a feed line without a title is worded without the quoted one', () => {
    const card = read('apps/web/src/components/edu/dashboard/activity-feed-card.tsx');
    expect(card).toContain('feed_${item.kind}_plain');
    for (const locale of ['pl', 'en']) {
      const messages = JSON.parse(
        read(`apps/web/src/i18n/messages/${locale}.json`),
      ).EduOverviewPage;
      for (const kind of ['quiz_completed', 'assignment_submitted', 'report_opened']) {
        expect(messages[`feed_${kind}_plain`], `${locale} ${kind}`).toBeTruthy();
      }
    }
  });

  it('the e2e spec only uses keys that still exist', () => {
    const spec = read('__tests__/e2e/edu-dashboard-stats.spec.ts');
    expect(spec).not.toContain('questions_card_title');
    expect(spec).not.toContain('flashcards_card_title');
    expect(spec).toContain('/api/v1/stats/teacher/groups');
    for (const locale of ['pl', 'en']) {
      const messages = JSON.parse(
        read(`apps/web/src/i18n/messages/${locale}.json`),
      ).EduOverviewPage;
      for (const key of ['total_questions', 'flashcards', 'students_stat', 'completed_stat']) {
        expect(messages[key], `${locale} ${key}`).toBeTruthy();
      }
    }
  });
});
