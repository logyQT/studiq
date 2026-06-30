'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, Users, Send, Settings } from 'lucide-react';

export default function ManageNotFound() {
  const t = useTranslations('ManageNotFound');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div className="space-y-6 max-w-md">
        <h1 className="text-9xl font-black text-foreground/10 select-none">404</h1>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">{t('title')}</h2>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-2">
          <Link
            href="/manage"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all font-medium text-sm"
          >
            <LayoutDashboard className="h-4 w-4" />
            {t('go_dashboard')}
          </Link>
        </div>

        <div className="pt-4">
          <p className="text-xs text-muted-foreground mb-3">{t('try_these')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href="/manage"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-accent transition-colors"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              {t('overview')}
            </Link>
            <Link
              href="/manage/members"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-accent transition-colors"
            >
              <Users className="h-3.5 w-3.5" />
              {t('members')}
            </Link>
            <Link
              href="/manage/invitations"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-accent transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              {t('invitations')}
            </Link>
            <Link
              href="/manage/settings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-accent transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
              {t('settings')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
