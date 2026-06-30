'use client';

import { Check, ChevronRight, Rocket, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiQuery } from '@/hooks/use-api';

const DISMISS_KEY = 'app_onboarding_dismissed';

interface StudentStats {
  totalQuizzes: number;
  avgScore: number;
  totalQuestionsCreated: number;
  flashcardsPracticed: number;
  flashcardAccuracy: number;
  totalDecks: number;
  totalFlashcards: number;
  dueToday: number;
}

export function OnboardingChecklist() {
  const t = useTranslations('AppOnboarding');
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const { data: stats, isLoading } = useApiQuery<StudentStats>({
    queryKey: ['stats', 'student'],
    url: '/api/v1/stats/student',
  });

  if (dismissed || isLoading) return null;

  const items = [
    { key: 'create_deck', href: '/app/flashcards/decks', done: (stats?.totalDecks ?? 0) > 0 },
    {
      key: 'add_flashcards',
      href: '/app/flashcards/decks',
      done: (stats?.totalFlashcards ?? 0) > 0,
    },
    { key: 'take_quiz', href: '/app/study', done: (stats?.totalQuizzes ?? 0) > 0 },
    {
      key: 'review_cards',
      href: '/app/study',
      done: (stats?.dueToday ?? 0) > 0 || (stats?.flashcardsPracticed ?? 0) > 0,
    },
  ];

  if (items.every((i) => i.done)) return null;

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      /* ignore */
    }
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Rocket className="size-5 text-primary" />
            <CardTitle className="text-lg">{t('title')}</CardTitle>
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={handleDismiss}>
            <X className="size-4" />
          </Button>
        </div>
        <CardDescription>{t('description')}</CardDescription>
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
                <span className={item.done ? 'line-through' : ''}>{t(item.key)}</span>
                <ChevronRight className="ml-auto size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
