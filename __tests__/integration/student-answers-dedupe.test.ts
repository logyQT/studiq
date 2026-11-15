import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json } from '#test/helpers/json';
import { before, type BeforeResult } from '#test/helpers/test-user';
import {
  cleanupQuestions,
  cleanupQuizAttempts,
  mockUser,
  useRealSupabase,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import { POST as quizPost } from '@/app/(backend)/api/v1/quiz/new/route';

const MIGRATION = 'supabase/migrations/20261113193000_student_answers_attempt_question_unique.sql';
const UNIQUE_INDEX = 'student_answers_attempt_question_key';

/**
 * The `DELETE` the migration ships, executed verbatim: the policy is the thing
 * under test, so a copy here could pass while production ships something else.
 */
const dedupe = (() => {
  const withoutComments = readFileSync(MIGRATION, 'utf8').replaceAll(/--[^\n]*/g, '');
  const statement = withoutComments
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('DELETE'));
  if (!statement) throw new Error(`${MIGRATION} has no DELETE statement`);
  return statement;
})();

/**
 * A `db reset` runs this migration against an empty table, so the collapse itself
 * is never exercised there. This suite seeds real duplicates over the direct
 * connection (`SUPABASE_DB_URL`, the same optional harness as
 * `invite-accept.test.ts`) and replays the shipped statement on them.
 */
const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/** One `student_answers` row as the dedupe leaves it. */
interface SurvivorRow {
  id: string;
  teacher_points: number | null;
  teacher_feedback: string | null;
}

/**
 * Seeds duplicate rows that the unique key would reject, runs the shipment's
 * collapse, checks the survivor, and rolls the whole scenario back. DDL is
 * transactional in Postgres, so dropping the key for the seed is undone with it.
 */
async function collapse(
  seed: (tx: postgres.TransactionSql) => Promise<void>,
  assertSurvivor: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<void> {
  const sql = postgres(localDatabaseUrl!, { max: 1, onnotice: () => {} });
  const rolledBack = new Error('seeded duplicates rolled back');
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`DROP INDEX IF EXISTS public.${UNIQUE_INDEX}`);
      await seed(tx);
      await tx.unsafe(dedupe);
      await assertSurvivor(tx);
      throw rolledBack;
    });
  } catch (error) {
    if (error !== rolledBack) throw error;
  } finally {
    await sql.end();
  }
}

describe('student_answers duplicate collapse (#1066)', () => {
  let student!: BeforeResult;
  let attemptId: string;
  /**
   * One question per case, so a case's seeded pair cannot collide with another
   * case's rows (the committed case leaves its pair behind until `afterAll`).
   */
  let questionIds: string[] = [];

  const pairFor = (caseIndex: number): { attemptId: string; questionId: string } => {
    const questionId = questionIds[caseIndex];
    if (!questionId) throw new Error(`no question for case ${caseIndex}`);
    return { attemptId, questionId };
  };

  function rowsFor(tx: postgres.TransactionSql, questionId: string) {
    return tx<SurvivorRow[]>`
      SELECT id::text, teacher_points, teacher_feedback
      FROM public.student_answers
      WHERE attempt_id = ${attemptId}::uuid AND question_id = ${questionId}::uuid
      ORDER BY id
    `;
  }

  beforeAll(async () => {
    useRealSupabase();
    student = await before({ role: 'student', questions: 3 });
    mockUser(student.user);
    const response = await quizPost(
      createNextRequest('http://localhost/api/v1/quiz/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionTypes: ['mcq'], questionCount: 3 }),
      }),
    );
    const body = await json<{ data?: { id?: string } }>(response);
    if (!body.data?.id) throw new Error(`Failed to create quiz: ${JSON.stringify(body)}`);
    attemptId = body.data.id;

    const { data: attemptQuestions, error } = await createTypedServiceClient()
      .from('quiz_attempt_questions')
      .select('question_id')
      .eq('attempt_id', attemptId);
    if (error) throw new Error(`Failed to read attempt questions: ${error.message}`);
    questionIds = attemptQuestions.map((row) => row.question_id);
    expect(questionIds).toHaveLength(3);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupQuestions(student.user.id, 'seed-question-');
  });

  it.skipIf(!localDatabaseUrl)(
    'keeps the teacher-graded row even when it has the larger uuid and is older',
    async () => {
      const { questionId } = pairFor(0);
      // The graded row is the odd one out on every axis the old rule used: it has
      // the larger uuid and the earlier `created_at`. Only the grading preference
      // keeps it — and dropping it would discard a teacher's points and feedback.
      const gradedId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
      const ungradedId = '00000000-0000-4000-8000-000000000001';

      await collapse(
        async (tx) => {
          await tx`
            INSERT INTO public.student_answers
              (id, attempt_id, question_id, question_type, is_correct, teacher_points,
               teacher_feedback, created_at)
            VALUES
              (${gradedId}::uuid, ${attemptId}::uuid, ${questionId}::uuid, 'mcq', true, 3,
               'Poprawna odpowiedź', now() - interval '1 minute'),
              (${ungradedId}::uuid, ${attemptId}::uuid, ${questionId}::uuid, 'mcq', false,
               null, null, now())
          `;
          expect(await rowsFor(tx, questionId)).toHaveLength(2);
        },
        async (tx) => {
          expect(await rowsFor(tx, questionId)).toEqual([
            { id: gradedId, teacher_points: 3, teacher_feedback: 'Poprawna odpowiedź' },
          ]);
        },
      );
    },
  );

  it.skipIf(!localDatabaseUrl)('keeps the later write of an ungraded duplicate pair', async () => {
    const { questionId } = pairFor(1);
    // The newer row carries the smaller uuid, so an `id`-descending tiebreak
    // would keep the older sheet: only `created_at` can pick the retry.
    const olderId = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
    const newerId = '00000000-0000-4000-8000-000000000002';

    await collapse(
      async (tx) => {
        await tx`
          INSERT INTO public.student_answers
            (id, attempt_id, question_id, question_type, is_correct, text_answer, created_at)
          VALUES
            (${olderId}::uuid, ${attemptId}::uuid, ${questionId}::uuid, 'mcq', false,
             'stara odpowiedź', now() - interval '1 minute'),
            (${newerId}::uuid, ${attemptId}::uuid, ${questionId}::uuid, 'mcq', true,
             'nowa odpowiedź', now())
        `;
      },
      async (tx) => {
        expect(await rowsFor(tx, questionId)).toEqual([
          { id: newerId, teacher_points: null, teacher_feedback: null },
        ]);
      },
    );
  });

  it.skipIf(!localDatabaseUrl)(
    'collapses an exact duplicate pair to one row and repeating the delete changes nothing',
    async () => {
      const { questionId } = pairFor(2);
      // No grading, same `created_at`: `id` is the final tiebreak, so the choice is
      // still deterministic and the statement is idempotent.
      const smallerId = '00000000-0000-4000-8000-000000000003';
      const largerId = 'ffffffff-ffff-4fff-8fff-fffffffffff3';
      const insertedAt = new Date('2026-11-13T19:30:00.000Z');

      await collapse(
        async (tx) => {
          await tx`
            INSERT INTO public.student_answers
              (id, attempt_id, question_id, question_type, is_correct, created_at)
            VALUES
              (${smallerId}::uuid, ${attemptId}::uuid, ${questionId}::uuid, 'mcq', false,
               ${insertedAt}),
              (${largerId}::uuid, ${attemptId}::uuid, ${questionId}::uuid, 'mcq', false,
               ${insertedAt})
          `;
          expect(await rowsFor(tx, questionId)).toHaveLength(2);
        },
        async (tx) => {
          await tx.unsafe(dedupe);
          expect(await rowsFor(tx, questionId)).toEqual([
            { id: largerId, teacher_points: null, teacher_feedback: null },
          ]);
        },
      );
    },
  );

  it.skipIf(!localDatabaseUrl)(
    'leaves the graded row as the only one `gradeAnswer` can read with `.single()`',
    async () => {
      // Case 1's pair was rolled back, so its question is free again.
      const { questionId } = pairFor(0);
      const gradedId = 'ffffffff-ffff-4fff-8fff-fffffffffff4';
      const ungradedId = '00000000-0000-4000-8000-000000000004';
      const sql = postgres(localDatabaseUrl!, { max: 1, onnotice: () => {} });
      const supabase = createTypedServiceClient();

      try {
        // One transaction: the `DROP INDEX` holds ACCESS EXCLUSIVE on the table
        // until commit, so no other session can write during the window and the
        // key is back before anyone else touches the table.
        await sql.begin(async (tx) => {
          await tx.unsafe(`DROP INDEX IF EXISTS public.${UNIQUE_INDEX}`);
          await tx`
            INSERT INTO public.student_answers
              (id, attempt_id, question_id, question_type, is_correct, teacher_points,
               teacher_feedback)
            VALUES
              (${gradedId}::uuid, ${attemptId}::uuid, ${questionId}::uuid, 'mcq', true, 2,
               'Zaliczone'),
              (${ungradedId}::uuid, ${attemptId}::uuid, ${questionId}::uuid, 'mcq', false,
               null, null)
          `;
          await tx.unsafe(dedupe);
          await tx.unsafe(`
            CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX}
              ON public.student_answers(attempt_id, question_id)
          `);
        });

        // The read `gradeAnswer` performs before deciding update vs insert
        // (teacher-assignment.service.ts): it needs exactly one row per pair.
        const { data: existing, error: readError } = await supabase
          .from('student_answers')
          .select('id, teacher_points, teacher_feedback')
          .eq('attempt_id', attemptId)
          .eq('question_id', questionId)
          .single();
        expect(readError).toBeNull();
        expect(existing).toEqual({
          id: gradedId,
          teacher_points: 2,
          teacher_feedback: 'Zaliczone',
        });

        // The key is live again, so a duplicate cannot come back.
        const { error: duplicateError } = await supabase.from('student_answers').insert({
          attempt_id: attemptId,
          question_id: questionId,
          question_type: 'mcq',
          is_correct: false,
        });
        expect(duplicateError?.code).toBe('23505');
      } finally {
        await sql.unsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX}
            ON public.student_answers(attempt_id, question_id)
        `);
        await sql`DELETE FROM public.student_answers WHERE attempt_id = ${attemptId}::uuid`;
        await sql.end();
      }
    },
  );
});
