import type { NotificationItem } from '@studiq/server/models/notification.model';

/** The three dashboards a reader can be in; reports live under each. */
export type NotificationArea = 'app' | 'edu' | 'manage';

/** Area of the app a pathname belongs to, or null outside the dashboards. */
export function notificationArea(pathname: string | null | undefined): NotificationArea | null {
  const first = (pathname ?? '').split('/')[1];
  return first === 'app' || first === 'edu' || first === 'manage' ? first : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** A payload id that is safe to put in a path: a UUID, or nothing. */
function id(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/**
 * Where a notification leads, for a reader in `area`. `null` when there is nowhere useful to go
 * (the list item is then only marked read). Ids come from the payload, so each is checked to be
 * a UUID before it becomes part of a path.
 */
export function notificationHref(
  item: Pick<NotificationItem, 'type' | 'payload'>,
  area: NotificationArea | null,
): string | null {
  switch (item.type) {
    case 'assignment_published': {
      const assignmentId = id(item.payload.assignmentId);
      return assignmentId ? `/app/assignments/${assignmentId}` : null;
    }
    case 'assignment_graded': {
      const assignmentId = id(item.payload.assignmentId);
      return assignmentId ? `/app/assignments/${assignmentId}/review` : null;
    }
    case 'report_message': {
      const reportId = id(item.payload.reportId);
      return reportId && area ? `/${area}/reports/${reportId}` : null;
    }
    case 'invitation_accepted':
      return area === 'manage' ? '/manage/members' : null;
  }
}

/** Values for the ICU message of a notification; a missing one is `null` (the message copes). */
export function notificationParams(
  item: Pick<NotificationItem, 'type' | 'payload'>,
): Record<string, string | null> {
  switch (item.type) {
    case 'assignment_published':
    case 'assignment_graded':
      return { title: text(item.payload.title) };
    case 'report_message':
      return { name: text(item.payload.senderName) };
    case 'invitation_accepted':
      return { name: text(item.payload.memberName) };
  }
}

/** Text of the unread badge: nothing at 0, the number up to 9, then "9+". */
export function unreadBadge(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

/** Fired by the user-menu entry; the bell listens and opens its popover. */
export const OPEN_NOTIFICATIONS_EVENT = 'studiq:open-notifications';
