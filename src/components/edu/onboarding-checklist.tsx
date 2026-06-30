'use client';

import { Check, ChevronRight, Rocket, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

  useEffect(() => {
    if (orgs.length === 0) return;
    if (user?.app_metadata?.role !== 'teacher' && user?.app_metadata?.role !== 'university_admin')
      return;
    fetch('/api/v1/organization/members')
      .then((r) => r.json())
      .then((d) => setMemberCount(d.data?.length || 0))
      .catch(() => {});
  }, [orgs, user]);

  if (dismissed || orgs.length === 0) return null;

  const items: ChecklistItem[] = [
    {
      key: 'create_org',
      labelKey: 'create_classroom',
      href: '/edu/classroom/new',
      done: orgs.length > 0,
    },
    {
      key: 'invite',
      labelKey: 'invite_students',
      href: '/edu/classroom/invite',
      done: memberCount > 1,
    },
    { key: 'content', labelKey: 'create_content', href: '/edu/flashcards/decks', done: false },
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
