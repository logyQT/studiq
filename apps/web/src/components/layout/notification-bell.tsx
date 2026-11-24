'use client';

import type { NotificationItem, NotificationType } from '@studiq/server/models/notification.model';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@studiq/ui';
import { Bell, CheckCheck, ClipboardCheck, FileCheck2, Flag, UserPlus } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/hooks/use-notifications';
import {
  notificationArea,
  notificationHref,
  notificationParams,
  OPEN_NOTIFICATIONS_EVENT,
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
  const contentRef = useRef<HTMLElement | null>(null);
  const { data, isLoading, isError, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unread = data?.unreadCount ?? 0;
  const badge = unreadBadge(unread);
  const items = data?.items ?? [];

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
  }, []);

  function openItem(item: NotificationItem) {
    if (!item.readAt) markRead.mutate(item.id);
    const href = notificationHref(item, area);
    setOpen(false);
    if (href) router.push(href);
  }

  function markAll() {
    markAllRead.mutate(undefined, {
      // The control unmounts once the list is read; keep the keyboard user inside the popover.
      onSuccess: () => contentRef.current?.focus(),
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* A new notification is announced politely; the badge itself is hidden from assistive tech. */}
      <output className="sr-only" aria-live="polite">
        {unread > 0 ? t('button_unread', { count: unread }) : ''}
      </output>
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
      <PopoverContent
        align="end"
        className="w-80 p-0"
        aria-label={t('title')}
        // Radix focuses the first control, which here is the bulk action: its tooltip would
        // open over the newest notification and take the first Escape press. Focus the
        // popover itself; one Tab still reaches the action.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = event.currentTarget;
          if (!(content instanceof HTMLElement)) return;
          contentRef.current = content;
          content.focus();
        }}
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="min-w-0 truncate text-sm font-semibold">{t('title')}</p>
          {unread > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('mark_all_read')}
                  disabled={markAllRead.isPending}
                  onClick={markAll}
                >
                  <CheckCheck className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" aria-hidden="true">
                {t('mark_all_read')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{t('loading')}</p>
          ) : isError && !data ? (
            // A failed read is not "no notifications", and the badge must not read 0 for it.
            <div role="alert" className="space-y-2 p-4 text-center">
              <p className="text-sm text-muted-foreground">{t('load_error')}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                {t('retry')}
              </Button>
            </div>
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
                        <>
                          <span
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                            aria-hidden="true"
                          />
                          <span className="sr-only">{t('unread')}</span>
                        </>
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
