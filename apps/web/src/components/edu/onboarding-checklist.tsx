'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { Check, ChevronRight, Rocket, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useOrgs } from '@/hooks/use-orgs';
import { SrLabel } from '@/components/shared/sr-label';

const DISMISS_KEY = 'onboarding_dismissed';

/** The endpoints answer `{ success, data }`; an unwrapped body is accepted too. */
function envelopeData(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'data' in body ? body.data : body;
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** `totalQuestions + totalFlashcards` from the teacher stats payload, missing fields as 0. */
function contentTotal(data: unknown): number {
  if (typeof data !== 'object' || data === null) return 0;
  const questions =
    'totalQuestions' in data && typeof data.totalQuestions === 'number' ? data.totalQuestions : 0;
  const flashcards =
    'totalFlashcards' in data && typeof data.totalFlashcards === 'number'
      ? data.totalFlashcards
      : 0;
  return questions + flashcards;
}

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
    if (orgs.length === 0) return undefined;
    // orgRoleName is the org_roles row name ('admin'/'teacher'/'member'),
    // a different concept from account_type ('educator'/'manager') — only
    // account_type is meaningful to compare against those two literals.
    // `app_metadata` is an untyped Supabase map; `account_type` must be narrowed.
    const rawAccountType: unknown = user?.app_metadata?.account_type;
    const accountType = typeof rawAccountType === 'string' ? rawAccountType : undefined;
    if (accountType !== 'educator' && accountType !== 'manager') return undefined;

    const controller = new AbortController();

    fetch('/api/v1/organization/members', { signal: controller.signal })
      .then(async (r) => {
        const body: unknown = await r.json();
        return body;
      })
      .then((d) => setMemberCount(countOf(envelopeData(d))))
      .catch(() => {});
    fetch('/api/v1/organization/groups', { signal: controller.signal })
      .then(async (r) => {
        const body: unknown = await r.json();
        return body;
      })
      .then((d) => setGroupCount(countOf(envelopeData(d))))
      .catch(() => {});
    fetch('/api/v1/stats/teacher', { signal: controller.signal })
      .then(async (r) => {
        const body: unknown = await r.json();
        return body;
      })
      .then((d) => setHasContent(contentTotal(envelopeData(d)) > 0))
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
            <SrLabel k="dismiss_checklist" />
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
