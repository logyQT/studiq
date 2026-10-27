import type { RequestContext } from '@studiq/authz';
import { error as logError } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  NotificationItem,
  NotificationList,
  NotificationType,
} from '@studiq/server/models/notification.model';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * What the rest of the server tells the notification centre. Every method is best effort and
 * never throws: a notification is a courtesy on top of the action that caused it, so it must not
 * be able to fail it. Producers depend on this interface (default: `noopNotifier`), which keeps
 * their own tests free of a database.
 */
export interface Notifier {
  /** A teacher published an assignment: every targeted student is told. */
  assignmentPublished(input: { assignmentId: string; teacherId: string }): Promise<void>;
  /** The first time a teacher grades a student's submission. */
  assignmentGraded(input: { assignmentId: string; studentId: string }): Promise<void>;
  /** A new message in a question report: the other participant is told. */
  reportMessage(input: {
    reportId: string;
    recipientId: string;
    senderId: string;
    organizationId: string | null;
  }): Promise<void>;
  /** Someone accepted an invitation: the person who sent it is told. */
  invitationAccepted(input: {
    inviterId: string;
    memberId: string;
    organizationId: string;
  }): Promise<void>;
}

export const noopNotifier: Notifier = {
  assignmentPublished: async () => {},
  assignmentGraded: async () => {},
  reportMessage: async () => {},
  invitationAccepted: async () => {},
};

interface NewNotification {
  userId: string;
  organizationId: string | null;
  type: NotificationType;
  payload: Record<string, unknown>;
}

interface NotificationRow {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  organization_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** Inserts are sent in batches so one big class does not become one huge statement. */
const INSERT_BATCH = 500;

/** Only a code or a class name is logged: database messages can quote ids and names. */
function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return 'UNKNOWN';
}

function toItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload ?? {},
    organizationId: row.organization_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export class NotificationService implements Notifier {
  constructor(
    private createClient: () => Promise<SupabaseClient>,
    /** Writes and the lookups of recipients: a user can read only their own rows. */
    private createAdminClient: () => SupabaseClient = createServiceClient,
  ) {}

  // ---- reading and marking, for the signed-in user

  async list(
    ctx: RequestContext,
    options: { limit: number; unread: boolean },
  ): Promise<ServiceResult<NotificationList>> {
    const supabase = await this.createClient();

    let items = supabase
      .from('notifications')
      .select('id, type, payload, organization_id, read_at, created_at')
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false })
      .limit(options.limit);
    if (options.unread) items = items.is('read_at', null);

    const [list, unread] = await Promise.all([
      items,
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', ctx.userId)
        .is('read_at', null),
    ]);

    if (list.error) return toDbFailure(list.error);
    if (unread.error) return toDbFailure(unread.error);

    return success({
      items: ((list.data ?? []) as NotificationRow[]).map(toItem),
      unreadCount: unread.count ?? 0,
    });
  }

  /** Marks one of the caller's notifications read; reading it again is not an error. */
  async markRead(ctx: RequestContext, id: string): Promise<ServiceResult<null>> {
    const supabase = await this.createClient();
    const { data: own, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('id', id)
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (error) return toDbFailure(error);
    // Someone else's notification is indistinguishable from one that does not exist.
    if (!own) return failure('NOT_FOUND');

    const { error: updateError } = await this.createAdminClient()
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', ctx.userId)
      .is('read_at', null);

    if (updateError) return toDbFailure(updateError);
    return success(null);
  }

  async markAllRead(ctx: RequestContext): Promise<ServiceResult<null>> {
    const { error } = await this.createAdminClient()
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', ctx.userId)
      .is('read_at', null);

    if (error) return toDbFailure(error);
    return success(null);
  }

  // ---- producers (best effort)

  async assignmentPublished(input: { assignmentId: string; teacherId: string }): Promise<void> {
    await this.safely('assignment_published', async () => {
      const admin = this.createAdminClient();
      const assignment = await this.assignment(input.assignmentId);
      if (!assignment) return;

      const { data: targets, error } = await admin
        .from('assignment_targets')
        .select('group_id, student_id')
        .eq('assignment_id', input.assignmentId);
      if (error) throw error;

      const recipients = new Set<string>();
      const groupIds: string[] = [];
      for (const target of targets ?? []) {
        if (target.student_id) recipients.add(target.student_id as string);
        if (target.group_id) groupIds.push(target.group_id as string);
      }

      if (groupIds.length > 0) {
        const { data: members, error: membersError } = await admin
          .from('group_members')
          .select('user_id')
          .in('group_id', groupIds)
          .eq('role', 'member');
        if (membersError) throw membersError;
        for (const member of members ?? []) recipients.add(member.user_id as string);
      }

      // The teacher may sit in the group too; they know they published it.
      recipients.delete(input.teacherId);

      await this.insert(
        [...recipients].map((userId) => ({
          userId,
          organizationId: assignment.organizationId,
          type: 'assignment_published' as const,
          payload: { assignmentId: input.assignmentId, title: assignment.title },
        })),
      );
    });
  }

  async assignmentGraded(input: { assignmentId: string; studentId: string }): Promise<void> {
    await this.safely('assignment_graded', async () => {
      const assignment = await this.assignment(input.assignmentId);
      if (!assignment) return;
      await this.insert([
        {
          userId: input.studentId,
          organizationId: assignment.organizationId,
          type: 'assignment_graded',
          payload: { assignmentId: input.assignmentId, title: assignment.title },
        },
      ]);
    });
  }

  async reportMessage(input: {
    reportId: string;
    recipientId: string;
    senderId: string;
    organizationId: string | null;
  }): Promise<void> {
    await this.safely('report_message', async () => {
      if (input.recipientId === input.senderId) return;
      await this.insert([
        {
          userId: input.recipientId,
          organizationId: input.organizationId,
          type: 'report_message',
          payload: {
            reportId: input.reportId,
            senderName: await this.displayName(input.senderId),
          },
        },
      ]);
    });
  }

  async invitationAccepted(input: {
    inviterId: string;
    memberId: string;
    organizationId: string;
  }): Promise<void> {
    await this.safely('invitation_accepted', async () => {
      if (input.inviterId === input.memberId) return;
      await this.insert([
        {
          userId: input.inviterId,
          organizationId: input.organizationId,
          type: 'invitation_accepted',
          payload: { memberName: await this.displayName(input.memberId) },
        },
      ]);
    });
  }

  // ---- internals

  private async insert(entries: NewNotification[]): Promise<void> {
    if (entries.length === 0) return;
    const admin = this.createAdminClient();

    for (let i = 0; i < entries.length; i += INSERT_BATCH) {
      const { error } = await admin.from('notifications').insert(
        entries.slice(i, i + INSERT_BATCH).map((entry) => ({
          user_id: entry.userId,
          organization_id: entry.organizationId,
          type: entry.type,
          payload: entry.payload,
        })),
      );
      if (error) throw error;
    }
  }

  private async assignment(
    id: string,
  ): Promise<{ title: string; organizationId: string | null } | null> {
    const { data } = await this.createAdminClient()
      .from('teacher_assignments')
      .select('title, organization_id')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    return {
      title: data.title as string,
      organizationId: (data.organization_id as string) ?? null,
    };
  }

  /** Name shown to the recipient: the profile name, else the part of the address before the @. */
  private async displayName(userId: string): Promise<string | null> {
    const { data } = await this.createAdminClient()
      .from('profiles')
      .select('full_name, email')
      .eq('id', userId)
      .maybeSingle();
    if (!data) return null;
    const fullName = (data.full_name as string | null)?.trim();
    return fullName || (data.email as string).split('@')[0] || null;
  }

  private async safely(type: NotificationType, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      logError('notification.failed', { type, errorCode: errorCode(err) });
    }
  }
}

export const notificationService = wrapService(
  new NotificationService(createClient),
  'notification.service',
);
