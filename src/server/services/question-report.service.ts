import type { RequestContext } from '@studiq/authz';
import type { SupabaseClient } from '@supabase/supabase-js';
import { wrapService } from '@/lib/observability';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import { toDbFailure } from '@/lib/supabase-errors';
import type {
  CreateQuestionReportInput,
  CreateReportMessageInput,
} from '@/server/models/question-report.model';

export type ReportTarget = { questionId: string } | { groupId: string };

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
      | { question_id: string; group_id?: never }
      | { group_id: string; question_id?: never };

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

    const { data, error } = await supabase
      .from('question_reports')
      .select(
        `*,
        question:question_id(id, content),
        group:group_id(id, name),
        reporter:reported_by(id, full_name, email),
        teacher:teacher_id(id, full_name, email)`,
      )
      .or(`reported_by.eq.${ctx.userId},teacher_id.eq.${ctx.userId}`)
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

    const participant = await this.fetchParticipantReport(id, ctx);
    if (!participant) return failure('NOT_FOUND');

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

    const report = await this.fetchParticipantReport(id, ctx);
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

    const report = await this.fetchParticipantReport(id, ctx);
    if (!report) return failure('NOT_FOUND');

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

    const { data, error } = await supabase
      .from('question_reports')
      .select(
        'id, reported_by, teacher_id, updated_at, reporter_last_read_at, teacher_last_read_at',
      )
      .or(`reported_by.eq.${ctx.userId},teacher_id.eq.${ctx.userId}`);

    if (error) return toDbFailure(error);

    const count = (data ?? []).filter((r) =>
      r.reported_by === ctx.userId
        ? new Date(r.updated_at) > new Date(r.reporter_last_read_at)
        : r.teacher_last_read_at == null ||
          new Date(r.updated_at) > new Date(r.teacher_last_read_at),
    ).length;

    return success({ count });
  }

  private async fetchParticipantReport(id: string, ctx: RequestContext) {
    const supabase = await this.createClient();
    const { data: report } = await supabase
      .from('question_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (!report) return null;
    if (report.reported_by !== ctx.userId && report.teacher_id !== ctx.userId) return null;
    return report;
  }
}
export const questionReportService = wrapService(
  new QuestionReportService(createClient),
  'question-report.service',
);
