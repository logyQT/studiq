import type { RequestContext } from '@studiq/authz';
import { can, check, Permission } from '@studiq/server/lib/authz';
import { AppError } from '@studiq/server/lib/errors';
import { error as logError } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import {
  EXPORT_MAX_QUESTIONS,
  type ImportQuestionsResult,
  type TransferQuestion,
  TransferQuestionSchema,
} from '@studiq/server/models/question-transfer.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import { questionService } from '@studiq/server/services/question.service';
import { questionBankService } from '@studiq/server/services/question-bank.service';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/**
 * Questions are removed 100 ids per request: one `in (…)` with the whole import (500 UUIDs)
 * is ~18 KB of query string and can be refused by a gateway, which would silently skip the
 * rollback and leave half-written questions behind.
 */
const ROLLBACK_BATCH_SIZE = 100;

/** Row of `questionService.list` as far as the export needs it. */
interface ListedQuestion {
  type: TransferQuestion['type'];
  content: string;
  explanation: string | null;
  topics?: Array<{ name: string }>;
  question_answers?: Array<{ content: string; is_correct: boolean; order_index: number | null }>;
}

/**
 * Question-bank import/export (#652). Export follows read and never truncates, import follows
 * update and lands completely or not at all; both stay in the bank's tenant, not the caller's.
 */
export class QuestionTransferService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  /**
   * Every question of a bank the caller may read, in the shape both file formats use.
   *
   * Export follows read: `questionService.list` already returns the answer key and the
   * explanation to anyone who can read the bank, so reading a bank means having all of it. A bank
   * above `EXPORT_MAX_QUESTIONS` is refused (422) instead of being cut off. `notReimportable`
   * counts the questions the importer would reject (the data is exported as it is).
   */
  async exportBank(
    ctx: RequestContext,
    bankId: string,
  ): Promise<
    ServiceResult<{ bankName: string; questions: TransferQuestion[]; notReimportable: number }>
  > {
    // The bank lookup applies the read permission, so a foreign or unknown bank is NOT_FOUND.
    const bank = await questionBankService.getById(bankId, ctx);
    if (!bank.success) return failure(bank.error);

    // The size is checked BEFORE reading: `questionService.list` has no range, so PostgREST clamps
    // it at its `max_rows` (1000) and a longer bank would come back silently truncated. The bank's
    // own question count (what the caller can see) is what tells a large bank from a cut one.
    const declared = Number((bank.data as { question_count?: number }).question_count ?? 0);
    if (declared > EXPORT_MAX_QUESTIONS) return failure('UNPROCESSABLE_ENTITY');

    const listed = await questionService.list(ctx, { bankId });
    if (!listed.success) return failure(listed.error);

    const rows = listed.data as ListedQuestion[];
    // Rows are never fewer than the bank claims: a shortfall would be a silent truncation.
    if (rows.length < declared) return failure('INTERNAL_SERVER');
    const questions = rows.map((row): TransferQuestion => {
      const answers = [...(row.question_answers ?? [])].sort(
        (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
      );
      return {
        type: row.type,
        content: row.content,
        ...(row.explanation ? { explanation: row.explanation } : {}),
        topics: (row.topics ?? []).map((topic) => topic.name),
        answers: answers.map((a) => ({ content: a.content, isCorrect: a.is_correct })),
      };
    });

    const notReimportable = questions.filter(
      (question) => !TransferQuestionSchema.safeParse(question).success,
    ).length;

    return success({ bankName: (bank.data as { name: string }).name, questions, notReimportable });
  }

  /**
   * Creates every question in one go. The rows were validated by the caller's schema; here
   * only what depends on the database is checked (the bank, the permission, the plan
   * limit). The writes are separate requests, so a failure after the questions exist removes
   * them again: an import either lands completely or not at all.
   */
  async importQuestions(
    ctx: RequestContext,
    bankId: string,
    questions: TransferQuestion[],
  ): Promise<ServiceResult<ImportQuestionsResult>> {
    if (!(await can(ctx, Permission.QUESTION_CREATE))) throw new AppError('FORBIDDEN');

    const supabase = await this.createClient();

    const { data: bank } = await supabase
      .from('question_banks')
      .select('id, created_by, organization_id, visibility')
      .eq('id', bankId)
      .single();
    if (!bank) return failure('NOT_FOUND');
    await check(ctx, Permission.QUESTION_BANK_UPDATE, bank);

    // The tenant is the bank's, not the caller's active organisation: `own` scope only compares
    // `created_by`, so taking it from the context would write a personal bank's questions into
    // whichever org happens to be active (and the reverse, which hides them from the org view).
    const organizationId: string | null = bank.organization_id ?? null;

    // The plan and the count must be the same bucket: a personal bank's questions are checked
    // against the personal plan, an org bank's against that org's plan, whichever org happens
    // to be selected in the app. `max_questions` is a user-scope key, so the resolver only uses
    // the org to pick between the seat and the org plan (and falls back to personal when the
    // caller is not a member of a stale/forged id).
    let owned = supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);
    owned = organizationId
      ? owned.eq('organization_id', organizationId)
      : owned.is('organization_id', null);
    const { count } = await owned;
    await limitsResolver.checkLimit(
      { ...ctx, activeOrgId: organizationId },
      'max_questions',
      count ?? 0,
      questions.length,
    );

    const topicIds = await this.resolveTopics(supabase, ctx, questions, organizationId);
    if (!topicIds.success) return failure(topicIds.error);

    // Ids are chosen here, so options and topic links never depend on the order a
    // multi-row INSERT returns its rows in.
    const ids = questions.map(() => crypto.randomUUID());

    const { error: questionError } = await supabase.from('questions').insert(
      questions.map((q, i) => ({
        id: ids[i],
        type: q.type,
        content: q.content,
        explanation: q.explanation ?? null,
        created_by: ctx.userId,
        organization_id: organizationId,
        visibility: bank.visibility ?? 'personal',
        bank_id: bankId,
      })),
    );
    if (questionError) return toDbFailure(questionError);

    const options = questions.flatMap((q, i) =>
      q.answers.map((a, order) => ({
        question_id: ids[i],
        content: a.content,
        is_correct: a.isCorrect,
        order_index: order,
      })),
    );
    const links = questions.flatMap((q, i) =>
      [...new Set(q.topics.map((name) => topicIds.data.get(name.toLowerCase())))]
        .filter((id): id is string => !!id)
        .map((topic_id) => ({ question_id: ids[i], topic_id })),
    );

    const writes = [
      options.length > 0 ? supabase.from('question_options').insert(options) : null,
      links.length > 0 ? supabase.from('question_topic_assignments').insert(links) : null,
    ];
    for (const write of writes) {
      const failed = write ? (await write).error : null;
      if (failed) {
        // Cascades remove the options and topic links of the questions created above.
        const cleanup = await this.removeCreated(supabase, ids);
        if (cleanup.error) {
          // The leftovers are recorded here, but the response still describes the failure the
          // caller hit: a cleanup error is not an authorization verdict (`42501` would turn a
          // half-written import into "you may not add questions"), and the span should carry the
          // cause, not the rollback.
          logError('question-transfer.rollback_failed', {
            bankId,
            total: ids.length,
            remaining: cleanup.remaining,
            originalError: `${failed.code}: ${failed.message}`,
            cleanupError: `${cleanup.error.code}: ${cleanup.error.message}`,
          });
        }
        return toDbFailure(failed);
      }
    }

    return success({ imported: questions.length });
  }

  /**
   * Deletes the questions of a failed import in batches. `remaining` counts the ids still in the
   * database when batching stopped, the failed batch included, so the log does not overstate what
   * the rollback left behind.
   */
  private async removeCreated(
    supabase: SupabaseClient,
    ids: string[],
  ): Promise<{ error: PostgrestError | null; remaining: number }> {
    for (let i = 0; i < ids.length; i += ROLLBACK_BATCH_SIZE) {
      const { error } = await supabase
        .from('questions')
        .delete()
        .in('id', ids.slice(i, i + ROLLBACK_BATCH_SIZE));
      if (error) return { error, remaining: ids.length - i };
    }
    return { error: null, remaining: 0 };
  }

  /** Name (lower case) -> topic id for every topic the file mentions; missing ones are created. */
  private async resolveTopics(
    supabase: SupabaseClient,
    ctx: RequestContext,
    questions: TransferQuestion[],
    organizationId: string | null,
  ): Promise<ServiceResult<Map<string, string>>> {
    const wanted = new Map<string, string>();
    for (const q of questions) {
      for (const name of q.topics) {
        if (!wanted.has(name.toLowerCase())) wanted.set(name.toLowerCase(), name);
      }
    }
    const byName = new Map<string, string>();
    if (wanted.size === 0) return success(byName);

    let existing = supabase.from('topics').select('id, name').eq('created_by', ctx.userId);
    existing = organizationId
      ? existing.eq('organization_id', organizationId)
      : existing.is('organization_id', null);
    const { data: own, error } = await existing;
    if (error) return toDbFailure(error);
    for (const topic of own ?? []) byName.set((topic.name as string).toLowerCase(), topic.id);

    const missing = [...wanted].filter(([key]) => !byName.has(key)).map(([, name]) => name);
    if (missing.length > 0) {
      const { data: created, error: createError } = await supabase
        .from('topics')
        .insert(
          missing.map((name) => ({
            name,
            created_by: ctx.userId,
            organization_id: organizationId,
            visibility: 'personal',
          })),
        )
        .select('id, name');
      if (createError) return toDbFailure(createError);
      for (const topic of created ?? []) byName.set((topic.name as string).toLowerCase(), topic.id);
    }

    return success(byName);
  }
}

export const questionTransferService = wrapService(
  new QuestionTransferService(createClient),
  'question-transfer.service',
);
