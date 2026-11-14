import type { RequestContext } from '@studiq/authz';
import { AccountType } from '@studiq/authz';
import { can, check, Permission } from '@studiq/server/lib/authz';
import { AppError } from '@studiq/server/lib/errors';
import { error as logError } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { isRecord } from '@studiq/server/lib/record';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import {
  EXPORT_MAX_QUESTIONS,
  type ImportQuestionsResult,
  type RawTransferQuestion,
  type TransferQuestion,
  TransferQuestionSchema,
} from '@studiq/server/models/question-transfer.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import { questionService } from '@studiq/server/services/question.service';
import { questionBankService } from '@studiq/server/services/question-bank.service';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * Questions are removed 100 ids per request: one `in (…)` with the whole import (500 UUIDs)
 * is ~18 KB of query string and can be refused by a gateway, which would silently skip the
 * rollback and leave half-written questions behind.
 */
const ROLLBACK_BATCH_SIZE = 100;

/**
 * Question-bank import/export (#652). Export follows read and never truncates, import follows
 * update and lands completely or not at all; both stay in the bank's tenant, not the caller's.
 */
export class QuestionTransferService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  /**
   * Every question of a bank the caller may read, in the shape both file formats use.
   *
   * Export follows read **and** the staff key permission (R15): reading a bank means having all
   * of it, answer key included, so the bank is listed by its id rather than through the narrower
   * `question.read` scope. A student never exports a key, and a caller without
   * `question_bank.update` on this bank is refused with `EXPORT_FORBIDDEN` rather than silently
   * losing the key column. A bank above `EXPORT_MAX_QUESTIONS` is refused (422) instead of being
   * cut off. `notReimportable` counts the questions the importer would reject (the data is
   * exported as it is).
   */
  async exportBank(
    ctx: RequestContext,
    bankId: string,
  ): Promise<
    ServiceResult<{ bankName: string; questions: RawTransferQuestion[]; notReimportable: number }>
  > {
    if (ctx.accountType === AccountType.STUDENT) return failure('EXPORT_FORBIDDEN');

    // The bank lookup applies the read permission, so a foreign or unknown bank is NOT_FOUND.
    const bank = await questionBankService.getById(bankId, ctx);
    if (!bank.success) return failure(bank.error);

    const bankRow = isRecord(bank.data) ? bank.data : null;
    const staffExport =
      bankRow !== null &&
      (await can(ctx, Permission.QUESTION_BANK_UPDATE, {
        id: bankId,
        created_by: typeof bankRow.created_by === 'string' ? bankRow.created_by : null,
        organization_id:
          typeof bankRow.organization_id === 'string' ? bankRow.organization_id : null,
      }));
    if (!staffExport) return failure('EXPORT_FORBIDDEN');

    const listed = await questionService.listBankQuestions(bankId);
    if (!listed.success) return failure(listed.error);

    const { questions: rows, total } = listed.data;

    // The cap is decided by the exact total of the query that builds the file: a longer bank is
    // refused (422) instead of being cut off at PostgREST's `max_rows` and shipped as a
    // "complete" export. The same number proves the read was not clamped.
    if (total > EXPORT_MAX_QUESTIONS) return failure('UNPROCESSABLE_ENTITY');
    if (rows.length < total) return failure('INTERNAL_SERVER');

    const questions = rows.map((row): RawTransferQuestion => {
      const answers = dbRows(row.question_answers).toSorted(
        (a, b) => a.order_index - b.order_index,
      );
      return {
        type: row.type,
        content: row.content,
        ...(row.explanation ? { explanation: row.explanation } : {}),
        topics: row.topics.map((topic) => topic.name),
        answers: answers.map((a) => ({ content: a.content, isCorrect: a.is_correct })),
      };
    });

    const notReimportable = questions.filter(
      (question) => !TransferQuestionSchema.safeParse(question).success,
    ).length;

    const bankData = bank.data;
    const bankName =
      isRecord(bankData) && typeof bankData.name === 'string' ? bankData.name : 'Unknown';
    return success({ bankName, questions, notReimportable });
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

    const supabase = await this.clientFactory();

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
    const prepared = questions.map((question) => ({ id: crypto.randomUUID(), question }));

    const { error: questionError } = await supabase.from('questions').insert(
      prepared.map(({ id, question }) => ({
        id,
        type: question.type,
        content: question.content,
        explanation: question.explanation ?? null,
        created_by: ctx.userId,
        organization_id: organizationId,
        visibility: bank.visibility,
        bank_id: bankId,
      })),
    );
    if (questionError) return toDbFailure(questionError);

    const options = prepared.flatMap(({ id, question }) =>
      question.answers.map((a, order) => ({
        question_id: id,
        content: a.content,
        is_correct: a.isCorrect,
        order_index: order,
      })),
    );
    const links = prepared.flatMap(({ id, question }) =>
      [...new Set(question.topics.map((name) => topicIds.data.get(name.toLowerCase())))]
        .filter((topicId): topicId is string => !!topicId)
        .map((topic_id) => ({ question_id: id, topic_id })),
    );

    const writes = [
      options.length > 0 ? supabase.from('question_options').insert(options) : null,
      links.length > 0 ? supabase.from('question_topic_assignments').insert(links) : null,
    ];
    for (const write of writes) {
      const failed = write ? (await write).error : null;
      if (failed) {
        // Cascades remove the options and topic links of the questions created above.
        const cleanup = await this.removeCreated(
          supabase,
          prepared.map((entry) => entry.id),
        );
        if (cleanup.error) {
          // The leftovers are recorded here, but the response still describes the failure the
          // caller hit: a cleanup error is not an authorization verdict (`42501` would turn a
          // half-written import into "you may not add questions"), and the span should carry the
          // cause, not the rollback.
          logError('question-transfer.rollback_failed', {
            bankId,
            total: prepared.length,
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
    supabase: SupabaseClient<Database>,
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
    supabase: SupabaseClient<Database>,
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
    for (const topic of dbRows(own)) byName.set(topic.name.toLowerCase(), topic.id);

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
      for (const topic of dbRows(created)) byName.set(topic.name.toLowerCase(), topic.id);
    }

    return success(byName);
  }
}

export const questionTransferService = wrapService(
  new QuestionTransferService(createClient),
  'question-transfer.service',
);
