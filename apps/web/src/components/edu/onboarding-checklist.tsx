'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { Check, ChevronRight, Rocket, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useOrgs } from '@/hooks/use-orgs';

const DISMISS_KEY = 'onboarding_dismissed';

type ChecklistItem = {
  key: string;
  labelKey: string;
  href: string;
  done: boolean;
};

export function OnboardingChecklist() {
  const t = useTranslations('OnboardingChecklist');
  const { user } = useAuth();
  const { orgs } = useOrgs();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [memberCount, setMemberCount] = useState(0);
  const [groupCount, setGroupCount] = useState(0);
  const [hasContent, setHasContent] = useState(false);

  useEffect(() => {
    if (orgs.length === 0) return;
    // orgRoleName is the org_roles row name ('admin'/'teacher'/'member'),
    // a different concept from account_type ('educator'/'manager') — only
    // account_type is meaningful to compare against those two literals.
    const accountType = user?.app_metadata?.account_type;
    if (accountType !== 'educator' && accountType !== 'manager') return;

    const controller = new AbortController();

    fetch('/api/v1/organization/members', { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setMemberCount(d.data?.length || 0))
      .catch(() => {});
    fetch('/api/v1/organization/groups', { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setGroupCount(d.data?.length || 0))
      .catch(() => {});
    fetch('/api/v1/stats/teacher', { signal: controller.signal })
      .then((r) => r.json())
      .then((d) =>
        setHasContent((d.data?.totalQuestions ?? 0) + (d.data?.totalFlashcards ?? 0) > 0),
      )
      .catch(() => {});

    return () => controller.abort();
  }, [orgs, user]);

  if (dismissed || orgs.length === 0) return null;

  const items: ChecklistItem[] = [
    { key: 'content', labelKey: 'create_content', href: '/edu/flashcards', done: hasContent },
    { key: 'group', labelKey: 'create_group', href: '/edu/groups', done: groupCount > 0 },
    {
      key: 'invite',
      labelKey: 'invite_students',
      href: '/edu/groups',
      done: memberCount > 1,
    },
  ];

  const allDone = items.every((i) => i.done);

  function handleDismiss() {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, 'true');
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Rocket className="size-5 text-primary" />
            <CardTitle className="text-lg">{allDone ? t('all_done_title') : t('title')}</CardTitle>
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={handleDismiss}>
            <X className="size-4" />
          </Button>
        </div>
        <CardDescription>{allDone ? t('all_done_desc') : t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent ${
                  item.done ? 'text-muted-foreground' : 'text-foreground'
                }`}
              >
                <div
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                    item.done
                      ? 'border-green-500 bg-green-50 dark:bg-green-950'
                      : 'border-muted-foreground/30'
                  }`}
                >
                  {item.done && <Check className="size-3 text-green-600" />}
                </div>
                <span className={item.done ? 'line-through' : ''}>{t(item.labelKey)}</span>
                <ChevronRight className="ml-auto size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
