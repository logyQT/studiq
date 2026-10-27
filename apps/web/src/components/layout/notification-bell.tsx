'use client';

import type { NotificationItem, NotificationType } from '@studiq/server/models/notification.model';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@studiq/ui';
import { Bell, ClipboardCheck, FileCheck2, Flag, UserPlus } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/hooks/use-notifications';
import {
  notificationArea,
  notificationHref,
  notificationParams,
  unreadBadge,
} from '@/lib/notifications';
import { formatRelativeTime } from '@/lib/relative-time';

const ICONS: Record<NotificationType, typeof Bell> = {
  assignment_published: ClipboardCheck,
  assignment_graded: FileCheck2,
  report_message: Flag,
  invitation_accepted: UserPlus,
};

/**
 * The notification centre (#664): a bell with an unread badge in the dashboard header and a
 * popover with the latest notifications. Clicking one marks it read and goes where it points.
 */
export function NotificationBell() {
  const t = useTranslations('Notifications');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const area = notificationArea(pathname);

  const [open, setOpen] = useState(false);
  const { data, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unread = data?.unreadCount ?? 0;
  const badge = unreadBadge(unread);
  const items = data?.items ?? [];

  function openItem(item: NotificationItem) {
    if (!item.readAt) markRead.mutate(item.id);
    const href = notificationHref(item, area);
    setOpen(false);
    if (href) router.push(href);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={unread > 0 ? t('button_unread', { count: unread }) : t('button')}
        >
          <Bell className="size-4" aria-hidden="true" />
          {badge && (
            <span
              className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
              aria-hidden="true"
            >
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">{t('title')}</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            {t('mark_all_read')}
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{t('loading')}</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const Icon = ICONS[item.type];
                const params = notificationParams(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/60"
                    >
                      <Icon
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${item.readAt ? '' : 'font-medium'}`}>
                          {t(`type_${item.type}`, {
                            title: params.title ?? t('untitled'),
                            name: params.name ?? t('someone'),
                          })}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatRelativeTime(item.createdAt, locale)}
                        </span>
                      </span>
                      {!item.readAt && (
                        <span
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                          role="img"
                          aria-label={t('unread')}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
