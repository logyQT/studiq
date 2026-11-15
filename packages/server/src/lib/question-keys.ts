import type { RequestContext } from '@studiq/authz';
import { evaluate, Permission, resolveScope } from '@studiq/server/lib/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { mapSupabaseError } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';

/** One question's key: its explanation and the ids of its correct options. */
export interface QuestionKey {
  explanation: string | null;
  correctOptionIds: string[];
}

/** The fields the staff decision needs; a question row or the bank that holds it. */
export interface QuestionKeyResource {
  created_by: string | null;
  organization_id: string | null;
}

/** How many question ids one key read asks for: keeps every request URL far below limits. */
const KEY_BATCH_SIZE = 200;

/**
 * Whether `ctx` may see the answer key of this question: its author, or a caller whose
 * `question_bank.update` scope reaches it. Synchronous on purpose — the question list decides
 * per row — and the `group` scope is excluded: a share link is not a grant of the keys (R1).
 */
export function canReadQuestionKey(ctx: RequestContext, question: QuestionKeyResource): boolean {
  const scope = resolveScope(ctx, Permission.QUESTION_BANK_UPDATE);
  if (!scope) return false;

  return evaluate({
    scope,
    userId: ctx.userId,
    resource: {
      createdBy: question.created_by ?? '',
      orgId: question.organization_id,
      activeOrgId: ctx.activeOrgId,
    },
  });
}

/**
 * Reads the answer key with the service role — the one function that can still see `is_correct`.
 * It may only be fed ids the caller obtained through a query it was already authorized to run
 * (its own attempt, the assignment it owns, the bank it authors); an id taken from a request
 * body or URL must never reach it.
 */
export async function readQuestionKeys(ids: readonly string[]): Promise<Map<string, QuestionKey>> {
  const keys = new Map<string, QuestionKey>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return keys;

  const supabase = createServiceClient();
  for (let i = 0; i < unique.length; i += KEY_BATCH_SIZE) {
    const batch = unique.slice(i, i + KEY_BATCH_SIZE);
    const [questions, options] = await Promise.all([
      supabase.from('questions').select('id, explanation').in('id', batch),
      supabase
        .from('question_options')
        .select('id, question_id, is_correct')
        .in('question_id', batch),
    ]);

    if (questions.error) return mapSupabaseError(questions.error);
    if (options.error) return mapSupabaseError(options.error);

    for (const question of dbRows(questions.data)) {
      keys.set(question.id, { explanation: question.explanation, correctOptionIds: [] });
    }
    for (const option of dbRows(options.data)) {
      if (!option.is_correct || !option.question_id) continue;
      keys.get(option.question_id)?.correctOptionIds.push(option.id);
    }
  }

  return keys;
}

/**
 * Adds the key and the explanation to a question the caller may read them for. Callers use it
 * only on staff/grading rows; a reader payload is never passed through here, so it keeps
 * neither field (absent, not null).
 */
export function withAnswerKey<
  O extends { id: string },
  T extends { id: string; question_answers?: readonly O[] },
>(
  question: T,
  key: QuestionKey | undefined,
): T & { explanation: string | null; question_answers: Array<O & { is_correct: boolean }> } {
  const correct = new Set(key?.correctOptionIds ?? []);
  return {
    ...question,
    explanation: key?.explanation ?? null,
    question_answers: (question.question_answers ?? []).map((option) => ({
      ...option,
      is_correct: correct.has(option.id),
    })),
  };
}
