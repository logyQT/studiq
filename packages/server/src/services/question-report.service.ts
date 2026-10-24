import { AccountType, type RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateQuestionReportInput,
  CreateReportMessageInput,
} from '@studiq/server/models/question-report.model';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReportTarget = { questionId: string } | { groupId: string };

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

  async list(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const orgScope = await this.resolveOrgWideReportScope(ctx, supabase);

    const { data, error } = await supabase
      .from('question_reports')
      .select(
        `*,
        question:question_id(id, content),
        group:group_id(id, name),
        reporter:reported_by(id, full_name, email),
        teacher:teacher_id(id, full_name, email)`,
      )
      .or(reportVisibilityFilter(ctx, orgScope))
      .order('updated_at', { ascending: false });

    if (error) return toDbFailure(error);

    const enriched = (data ?? []).map((r) => ({
      ...r,
      isUnread:
        r.reported_by === ctx.userId
          ? new Date(r.updated_at) > new Date(r.reporter_last_read_at)
          : r.teacher_last_read_at == null ||
            new Date(r.updated_at) > new Date(r.teacher_last_read_at),
    }));

    return success(enriched);
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const accessible = await this.fetchAccessibleReport(id, ctx);
    if (!accessible) return failure('NOT_FOUND');

    const { data: report, error: reportError } = await supabase
      .from('question_reports')
      .select(
        `*,
        question:question_id(id, content),
        group:group_id(id, name),
        reporter:reported_by(id, full_name, email),
        teacher:teacher_id(id, full_name, email)`,
      )
      .eq('id', id)
      .single();

    if (reportError) return toDbFailure(reportError);

    const { data: messages, error } = await supabase
      .from('question_report_messages')
      .select('*, sender:sender_id(id, full_name, email)')
      .eq('report_id', id)
      .order('created_at', { ascending: true });

    if (error) return toDbFailure(error);

    return success({ report, messages: messages ?? [] });
  }

  async addMessage(
    id: string,
    data: CreateReportMessageInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const report = await this.fetchAccessibleReport(id, ctx);
    if (!report) return failure('NOT_FOUND');

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

  private async fetchAccessibleReport(id: string, ctx: RequestContext) {
    const supabase = await this.createClient();
    const { data: report } = await supabase
      .from('question_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (!report) return null;
    if (isReportParticipant(report, ctx.userId)) return report;

    const orgScope = await this.resolveOrgWideReportScope(ctx, supabase);
    if (!orgScope || report.organization_id !== orgScope) return null;
    return report;
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
