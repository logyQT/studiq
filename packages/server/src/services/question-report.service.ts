import { AccountType, type RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { decodeCursor, encodeCursor } from '@studiq/server/lib/query-list';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateQuestionReportInput,
  CreateReportMessageInput,
  QuestionReportListQuery,
  UpdateQuestionReportInput,
} from '@studiq/server/models/question-report.model';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReportTarget = { questionId: string } | { groupId: string };

type ReportRow = {
  id: string;
  reported_by: string;
  teacher_id: string;
  organization_id: string | null;
  status: 'open' | 'resolved';
  resolved_at: string | null;
  resolved_by: string | null;
  updated_at: string;
  reporter_last_read_at: string;
  teacher_last_read_at: string | null;
};

const REPORT_RELATIONS = `*,
  question:question_id(id, content),
  group:group_id(id, name),
  reporter:reported_by(id, full_name, email),
  teacher:teacher_id(id, full_name, email),
  resolver:resolved_by(id, full_name, email)`;

function isReportParticipant(
  report: { reported_by: string; teacher_id: string },
  userId: string,
): boolean {
  return report.reported_by === userId || report.teacher_id === userId;
}

/**
 * PostgREST filter for the reports the caller may see. An org admin sees every
 * report of the active org *plus* the threads they participate in anywhere
 * (legacy `organization_id IS NULL` rows included) — the pre-fix visibility is
 * never taken away, org-wide rows are added on top.
 */
function reportVisibilityFilter(ctx: RequestContext, orgScope: string | null): string {
  const participant = `reported_by.eq.${ctx.userId},teacher_id.eq.${ctx.userId}`;
  return orgScope ? `organization_id.eq.${orgScope},${participant}` : participant;
}

export class QuestionReportService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async createReport(
    target: ReportTarget,
    data: CreateQuestionReportInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    let organizationId: string | null;
    let recipientId: string;
    let insertTarget:
      { question_id: string; group_id?: never } | { group_id: string; question_id?: never };

    if ('questionId' in target) {
      const { data: question, error: questionError } = await supabase
        .from('questions')
        .select('id, created_by, organization_id')
        .eq('id', target.questionId)
        .single();

      if (questionError) return toDbFailure(questionError);
      if (!question) return failure('NOT_FOUND');
      if (question.created_by === ctx.userId) return failure('BAD_REQUEST');

      organizationId = question.organization_id;
      recipientId = question.created_by;
      insertTarget = { question_id: target.questionId };
    } else {
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .select('id, created_by, organization_id')
        .eq('id', target.groupId)
        .single();

      if (groupError) return toDbFailure(groupError);
      if (!group) return failure('NOT_FOUND');
      if (group.created_by === ctx.userId) return failure('BAD_REQUEST');

      if (group.created_by) {
        recipientId = group.created_by;
      } else {
        const { data: admin } = await supabase
          .from('org_members')
          .select('user_id, org_roles!inner(name)')
          .eq('organization_id', group.organization_id)
          .eq('org_roles.name', 'admin')
          .order('joined_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!admin) return failure('NOT_FOUND');
        recipientId = admin.user_id;
      }

      organizationId = group.organization_id;
      insertTarget = { group_id: target.groupId };
    }

    const { data: report, error: reportError } = await supabase
      .from('question_reports')
      .insert({
        ...insertTarget,
        organization_id: organizationId,
        reported_by: ctx.userId,
        teacher_id: recipientId,
      })
      .select()
      .single();

    if (reportError) return toDbFailure(reportError);

    const { error: messageError } = await supabase.from('question_report_messages').insert({
      report_id: report.id,
      sender_id: ctx.userId,
      body: data.message,
    });

    if (messageError) return toDbFailure(messageError);
    return success(report);
  }

  async list(
    ctx: RequestContext,
    queryParams?: Partial<QuestionReportListQuery>,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const orgScope = await this.resolveOrgWideReportScope(ctx, supabase);

    // Visibility is the first `.or()` on purpose: `supabase-js` appends the
    // `or` params, so PostgREST ANDs this scope with the search/cursor filters
    // below and no filter can ever widen it (#276 regression guard).
    let query = supabase
      .from('question_reports')
      .select(REPORT_RELATIONS)
      .or(reportVisibilityFilter(ctx, orgScope));

    if (queryParams?.status && queryParams.status !== 'all') {
      query = query.eq('status', queryParams.status);
    }

    if (queryParams?.q) {
      const pattern = `%${queryParams.q}%`;
      const [questions, groups] = await Promise.all([
        supabase.from('questions').select('id').ilike('content', pattern).limit(200),
        supabase.from('groups').select('id').ilike('name', pattern).limit(200),
      ]);
      if (questions.error) return toDbFailure(questions.error);
      if (groups.error) return toDbFailure(groups.error);

      const targetFilter = [
        ...(questions.data ?? []).map((r) => `question_id.eq.${r.id}`),
        ...(groups.data ?? []).map((r) => `group_id.eq.${r.id}`),
      ].join(',');
      if (!targetFilter) return success({ items: [], nextCursor: null, hasMore: false });
      query = query.or(targetFilter);
    }

    const sortBy = queryParams?.sortBy ?? 'updated_at';
    const sortOrder = queryParams?.sortOrder ?? 'desc';
    const sortAsc = sortOrder === 'asc';
    query = query.order(sortBy, { ascending: sortAsc }).order('id');

    const pageSize = Math.min(queryParams?.limit ?? 24, 100);
    query = query.limit(pageSize + 1);

    if (queryParams?.cursor) {
      let cursor: { v: string | number; id: string };
      try {
        cursor = decodeCursor(queryParams.cursor);
      } catch {
        return failure('BAD_REQUEST');
      }
      const op = sortAsc ? 'gt' : 'lt';
      query = query.or(
        `${sortBy}.${op}.${cursor.v},and(${sortBy}.eq.${cursor.v},id.gt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) return toDbFailure(error);

    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const hasMore = rows.length > pageSize;
    const sliced = hasMore ? rows.slice(0, pageSize) : rows;

    const items = sliced.map((r) => ({
      ...r,
      isUnread:
        r.reported_by === ctx.userId
          ? new Date(r.updated_at as string) > new Date(r.reporter_last_read_at as string)
          : r.teacher_last_read_at == null ||
            new Date(r.updated_at as string) > new Date(r.teacher_last_read_at as string),
    }));

    const last = sliced[sliced.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last[sortBy], last.id) : null;

    return success({ items, nextCursor, hasMore });
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const access = await this.fetchReportAccess(id, ctx);
    if (!access) return failure('NOT_FOUND');

    const { data: report, error: reportError } = await supabase
      .from('question_reports')
      .select(REPORT_RELATIONS)
      .eq('id', id)
      .single();

    if (reportError) return toDbFailure(reportError);

    const { data: messages, error } = await supabase
      .from('question_report_messages')
      .select('*, sender:sender_id(id, full_name, email)')
      .eq('report_id', id)
      .order('created_at', { ascending: true });

    if (error) return toDbFailure(error);

    // Resolve is recipient-only (plus the #276 org admin); either participant
    // (plus the org admin) may reopen. The UI must not re-derive this.
    const isParticipant = isReportParticipant(report as ReportRow, ctx.userId);
    const canResolve = (report as ReportRow).teacher_id === ctx.userId || access.orgScope !== null;
    const canReopen = isParticipant || access.orgScope !== null;

    return success({
      report: { ...report, canResolve, canReopen },
      messages: messages ?? [],
    });
  }

  /**
   * Resolve (recipient / org admin) or reopen (either participant / org admin)
   * a report. The reporter can never resolve their own report.
   */
  async setStatus(
    id: string,
    data: UpdateQuestionReportInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const access = await this.fetchReportAccess(id, ctx);
    if (!access) return failure('NOT_FOUND');

    const { report, orgScope } = access;
    const isParticipant = isReportParticipant(report, ctx.userId);
    const isRecipient = report.teacher_id === ctx.userId;

    if (data.status === 'resolved') {
      if (!isRecipient && orgScope === null) return failure('FORBIDDEN');
    } else if (!isParticipant && orgScope === null) {
      return failure('FORBIDDEN');
    }

    if (report.status === data.status) return success(report);

    const now = new Date().toISOString();
    const patch: Record<string, unknown> =
      data.status === 'resolved'
        ? { status: 'resolved', resolved_at: now, resolved_by: ctx.userId, updated_at: now }
        : { status: 'open', resolved_at: null, resolved_by: null, updated_at: now };

    // Never write the other participant's receipt, and never write any receipt
    // for a non-participant org admin (same rule as `markRead` above).
    if (isParticipant) {
      patch[report.reported_by === ctx.userId ? 'reporter_last_read_at' : 'teacher_last_read_at'] =
        now;
    }

    const { data: updated, error } = await supabase
      .from('question_reports')
      .update(patch)
      .eq('id', id)
      .select(REPORT_RELATIONS)
      .single();

    if (error) return toDbFailure(error);
    if (!updated) return failure('NOT_FOUND');
    return success(updated);
  }

  async addMessage(
    id: string,
    data: CreateReportMessageInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const report = await this.fetchAccessibleReport(id, ctx);
    if (!report) return failure('NOT_FOUND');

    // Replying reopens a resolved thread for either participant (and the #276
    // org admin). The message trigger then bumps `updated_at` + receipts.
    if (report.status === 'resolved') {
      const { error: reopenError } = await supabase
        .from('question_reports')
        .update({ status: 'open', resolved_at: null, resolved_by: null })
        .eq('id', id);

      if (reopenError) return toDbFailure(reopenError);
    }

    const { data: message, error } = await supabase
      .from('question_report_messages')
      .insert({ report_id: id, sender_id: ctx.userId, body: data.body })
      .select('*, sender:sender_id(id, full_name, email)')
      .single();

    if (error) return toDbFailure(error);
    return success(message);
  }

  async markRead(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const report = await this.fetchAccessibleReport(id, ctx);
    if (!report) return failure('NOT_FOUND');

    // An org admin observing a thread they are not part of must not write the
    // participants' read receipts — that would clear the teacher's unread badge.
    if (!isReportParticipant(report, ctx.userId)) return success(null);

    const column =
      report.reported_by === ctx.userId ? 'reporter_last_read_at' : 'teacher_last_read_at';

    const { error } = await supabase
      .from('question_reports')
      .update({ [column]: new Date().toISOString() })
      .eq('id', id);

    if (error) return toDbFailure(error);
    return success(null);
  }

  async unreadCount(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const orgScope = await this.resolveOrgWideReportScope(ctx, supabase);

    const { data, error } = await supabase
      .from('question_reports')
      .select(
        'id, reported_by, teacher_id, updated_at, reporter_last_read_at, teacher_last_read_at',
      )
      .or(reportVisibilityFilter(ctx, orgScope));

    if (error) return toDbFailure(error);

    const count = (data ?? []).filter((r) =>
      r.reported_by === ctx.userId
        ? new Date(r.updated_at) > new Date(r.reporter_last_read_at)
        : r.teacher_last_read_at == null ||
          new Date(r.updated_at) > new Date(r.teacher_last_read_at),
    ).length;

    return success({ count });
  }

  private async fetchReportAccess(
    id: string,
    ctx: RequestContext,
  ): Promise<{ report: ReportRow; orgScope: string | null } | null> {
    const supabase = await this.createClient();
    const { data: report } = await supabase
      .from('question_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (!report) return null;
    if (isReportParticipant(report as ReportRow, ctx.userId)) {
      return { report: report as ReportRow, orgScope: null };
    }

    const orgScope = await this.resolveOrgWideReportScope(ctx, supabase);
    if (!orgScope || report.organization_id !== orgScope) return null;
    return { report: report as ReportRow, orgScope };
  }

  private async fetchAccessibleReport(id: string, ctx: RequestContext) {
    const access = await this.fetchReportAccess(id, ctx);
    return access?.report ?? null;
  }

  /**
   * Active org id when the caller is the org's admin and may read every report
   * in it; null otherwise (participant-only scope applies).
   */
  private async resolveOrgWideReportScope(
    ctx: RequestContext,
    supabase: SupabaseClient,
  ): Promise<string | null> {
    if (ctx.accountType !== AccountType.MANAGER) return null;
    const orgId = ctx.activeOrgId;
    if (!orgId || !ctx.orgRoleId) return null;

    const { data } = await supabase
      .from('org_roles')
      .select('name, is_system')
      .eq('id', ctx.orgRoleId)
      .eq('organization_id', orgId)
      .maybeSingle();

    return data?.is_system === true && data.name === 'admin' ? orgId : null;
  }
}
export const questionReportService = wrapService(
  new QuestionReportService(createClient),
  'question-report.service',
);
