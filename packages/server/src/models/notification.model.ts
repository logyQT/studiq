import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

/** Every kind of notification; the database CHECK holds the same list. */
export const NOTIFICATION_TYPES = [
  'assignment_published',
  'assignment_graded',
  'report_message',
  'invitation_accepted',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NotificationListQuerySchema = registry.register(
  'NotificationListQuery',
  z.object({
    limit: z.coerce.number().int().min(1).max(50).default(15),
    /** `true` / `1` lists only unread notifications. */
    unread: z
      .enum(['true', 'false', '1', '0'])
      .optional()
      .transform((value) => value === 'true' || value === '1'),
  }),
);

export const NotificationIdParamsSchema = registry.register(
  'NotificationIdParams',
  z.object({ id: z.uuid({ error: ValidationErrorCode.UUID_INVALID }) }),
);

export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

/** What each type carries; the client renders the text from it in the reader's language. */
export interface NotificationPayloads {
  assignment_published: { assignmentId: string; title: string };
  assignment_graded: { assignmentId: string; title: string };
  report_message: { reportId: string; senderName: string | null };
  invitation_accepted: { memberName: string | null };
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  organizationId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Answer of `GET /api/v1/notifications`. */
export interface NotificationList {
  items: NotificationItem[];
  /** Unread notifications of the caller, not only those in `items`. */
  unreadCount: number;
}
