'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Check, X, ArrowLeft, Minus, Zap } from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { SessionSummaryDialog } from '@/components/flashcards/session-summary-dialog';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

interface Flashcard {
  id: string;
  front: string;
  back: string;
  createdAt: string | null;
  reviewState: {
    easinessFactor: number;
    intervalDays: number;
    repetitions: number;
    nextReviewAt: string;
    lastReviewedAt: string | null;
    lastQuality: number | null;
  } | null;
}

interface LocalSM2State {
  interval: number;
  easeFactor: number;
  repetitions: number;
  correctStreak: number;
}

interface QueueItem {
  card: Flashcard;
  priority: number;
}

const BATCH_SIZE = 20;
const REFILL_THRESHOLD = 5;
const MASTERED_INTERVAL_DAYS = 21;
const MASTERED_REPETITIONS = 5;
const MASTERED_EASINESS_FACTOR = 2.5;

function generateUUID(): string {
  return crypto.randomUUID();
}

function calculateSM2(
  state: LocalSM2State,
  confidence: number,
): LocalSM2State {
  const { interval, easeFactor, repetitions, correctStreak } = state;

  if (confidence <= 1) {
    return { interval: 1, easeFactor: Math.max(1.3, easeFactor - 0.2), repetitions: 0, correctStreak: 0 };
  }
  if (confidence === 2) {
    return { interval: Math.max(1, Math.round(interval * 1.2)), easeFactor: Math.max(1.3, easeFactor - 0.15), repetitions, correctStreak: 0 };
  }
  const newReps = repetitions + 1;
  const newInterval = newReps === 1 ? 1 : newReps === 2 ? 6 : Math.round(interval * easeFactor * (confidence === 4 ? 1.3 : 1));
  const newEF = easeFactor + (0.1 - (5 - confidence) * (0.08 + (5 - confidence) * 0.02));
  return { interval: newInterval, easeFactor: Math.max(1.3, newEF), repetitions: newReps, correctStreak: correctStreak + 1 };
}

function calculatePriority(card: Flashcard, sm2: LocalSM2State): number {
  const rs = card.reviewState;
  if (!rs) {
    return sm2.correctStreak === 0 && sm2.repetitions === 0 ? 150 : 120;
  }

  const { intervalDays, repetitions, easinessFactor, lastQuality } = rs;

  let priority = 0;

  const recency = Math.max(0, 30 - intervalDays);
  priority += recency * 8;

  const unfamiliarity = Math.max(0, 10 - repetitions) * 12;
  priority += unfamiliarity;

  const difficulty = Math.max(0, 2.5 - easinessFactor) * 35;
  priority += difficulty;

  if (lastQuality != null && lastQuality < 3) {
    priority += 60;
  }

  if (sm2.correctStreak === 0 && (sm2.repetitions === 0 || intervalDays <= 1)) {
    priority += 40;
  }

  if (sm2.correctStreak >= 3) {
    priority -= 30;
  }

  return Math.max(1, priority);
}

function isMastered(card: Flashcard): boolean {
  const rs = card.reviewState;
  if (!rs) return false;
  return (
    rs.intervalDays >= MASTERED_INTERVAL_DAYS &&
    rs.repetitions >= MASTERED_REPETITIONS &&
    rs.easinessFactor >= MASTERED_EASINESS_FACTOR
  );
}

function buildInitialQueue(cards: Flashcard[], isPractice: boolean): QueueItem[] {
  let effective = isPractice ? cards.filter((c) => !isMastered(c)) : cards;
  if (effective.length === 0) effective = cards;
  const items: QueueItem[] = effective.map((card) => ({
    card,
    priority: 100,
  }));
  items.sort(() => Math.random() - 0.5);
  return items;
}

function reinsertByPriority(queue: QueueItem[], updated: QueueItem): QueueItem[] {
  const filtered = queue.filter((item) => item.card.id !== updated.card.id);
  const idx = filtered.findIndex((item) => item.priority <= updated.priority);
  if (idx === -1) {
    filtered.push(updated);
  } else {
    filtered.splice(idx, 0, updated);
  }
  return filtered;
}

interface SessionClientProps {
  initialCards: Flashcard[];
  mode: string;
  studyMode: string;
  targetCount: number;
  hasMore: boolean;
  deckIds?: string[];
}

export default function SessionClient({ initialCards, mode, studyMode, targetCount, hasMore: initialHasMore, deckIds }: SessionClientProps) {
  const t = useTranslations('AppFlashcardSessionPage');
  const navT = useTranslations('AppFlashcardsPage');
  const router = useRouter();

  const isPractice = mode === 'practice';
  const isStudy = mode === 'study';
  const isLimited = studyMode === 'limited';

  const sessionIdRef = useRef<string>(generateUUID());
  const startedAtRef = useRef<number>(Date.now());
  const processingRef = useRef(false);
  const answeredCountRef = useRef(0);
  const pendingUpdatesRef = useRef<Array<{ flashcardId: string; wasCorrect: boolean; confidenceLevel: number }>>([]);
  const hasFinalisedRef = useRef(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [allCaughtUp, setAllCaughtUp] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [summaryData, setSummaryData] = useState<{
    cardsStudied: number;
    cardsCorrect: number;
    durationMs: number;
    mode: string;
  } | null>(null);

  const [queueItems, setQueueItems] = useState<QueueItem[]>(() => {
    if (isPractice) {
      return buildInitialQueue(initialCards, true);
    }
    return initialCards.map((c) => ({ card: c, priority: 100 }));
  });

  const [_localSM2, setLocalSM2] = useState<Map<string, LocalSM2State>>(() => {
    if (isPractice) {
      const m = new Map<string, LocalSM2State>();
      let effective = initialCards.filter((c) => !isMastered(c));
      if (effective.length === 0) effective = initialCards;
      effective.forEach((c) => {
        const rs = c.reviewState;
        m.set(c.id, {
          interval: rs?.intervalDays ?? 1,
          easeFactor: rs?.easinessFactor ?? 2.5,
          repetitions: rs?.repetitions ?? 0,
          correctStreak: 0,
        });
      });
      return m;
    }
    return new Map();
  });

  const fetchDueCards = useCallback(async (): Promise<Flashcard[]> => {
    try {
      const res = await fetch(`/api/v1/flashcards/practice/due?limit=${BATCH_SIZE}`);
      if (!res.ok) return [];
      const body = await res.json();
      return (body.data ?? []).map((card: {
        id: string; front: string; back: string;
        createdAt?: string | null;
        reviewState?: {
          easinessFactor: number; intervalDays: number; repetitions: number;
          nextReviewAt: string; lastReviewedAt: string | null; lastQuality: number | null;
        } | null;
      }) => ({
        id: card.id,
        front: card.front,
        back: card.back,
        createdAt: card.createdAt ?? null,
        reviewState: card.reviewState ?? null,
      }));
    } catch {
      return [];
    }
  }, []);

  const sendBatchUpdate = useCallback(async () => {
    if (pendingUpdatesRef.current.length === 0) return;
    const batch = [...pendingUpdatesRef.current];
    pendingUpdatesRef.current = [];
    try {
      await fetch('/api/v1/flashcards/batch/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: batch.map((b) => ({ ...b, sessionId: sessionIdRef.current })),
        }),
      });
    } catch {
      pendingUpdatesRef.current.unshift(...batch);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      sendBatchUpdate();
    }, 30_000);
    return () => clearInterval(interval);
  }, [sendBatchUpdate]);

  useEffect(() => {
    if (!sessionComplete && !allCaughtUp) return;
    if (hasFinalisedRef.current) return;
    hasFinalisedRef.current = true;

    const durationMs = Date.now() - startedAtRef.current;

    const finalise = async () => {
      await sendBatchUpdate();

      const sessionData = {
        sessionId: sessionIdRef.current,
        startedAt: new Date(startedAtRef.current).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        cardsStudied: totalAnswered,
        cardsCorrect: correctCount,
        deckIds: deckIds ?? [],
        mode: isPractice ? 'practice' : isStudy ? 'study' : 'quick',
      };

      setSummaryData({
        cardsStudied: totalAnswered,
        cardsCorrect: correctCount,
        durationMs,
        mode: isPractice ? 'practice' : isStudy ? 'study' : 'quick',
      });

      await fetch('/api/v1/flashcards/practice/sessions/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData),
      }).catch(() => {});
    };

    finalise();
  }, [sessionComplete, allCaughtUp, totalAnswered, correctCount, isPractice, isStudy, deckIds, sendBatchUpdate]);

  const refillQueue = useCallback(async () => {
    if (!hasMore || isPractice) return;
    const moreCards = await fetchDueCards();
    if (moreCards.length === 0) {
      setHasMore(false);
      return;
    }
    setQueueItems((prev) => {
      const existingIds = new Set(prev.map((c) => c.card.id));
      const unique = moreCards.filter((c) => !existingIds.has(c.id));
      return [...prev, ...unique.map((c) => ({ card: c, priority: 100 }))];
    });
    if (moreCards.length < BATCH_SIZE) {
      setHasMore(false);
    }
  }, [fetchDueCards, hasMore, isPractice]);

  const handleAnswer = useCallback(
    async (wasCorrect: boolean, confidenceLevel: number) => {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        const currentItem = queueItems[currentIndex];
        if (!currentItem) return;
        const currentCard = currentItem.card;

        pendingUpdatesRef.current.push({ flashcardId: currentCard.id, wasCorrect, confidenceLevel });
        answeredCountRef.current++;
        if (answeredCountRef.current >= 10) {
          answeredCountRef.current = 0;
          await sendBatchUpdate();
        }

        if (isPractice) {
          const prevState = _localSM2.get(currentCard.id) ?? { interval: 1, easeFactor: 2.5, repetitions: 0, correctStreak: 0 };
          const newSM2 = calculateSM2(prevState, confidenceLevel);
          setLocalSM2((prev) => {
            const updated = new Map(prev);
            updated.set(currentCard.id, newSM2);
            return updated;
          });
          const newPriority = calculatePriority(currentCard, newSM2);
          setQueueItems((qPrev) => {
            const updatedItem: QueueItem = { card: currentCard, priority: newPriority };
            return reinsertByPriority(qPrev, updatedItem);
          });
        }

        setTotalAnswered((prev) => prev + 1);
        if (wasCorrect) {
          setCorrectCount((prev) => prev + 1);
        }

        if (isLimited && correctCount + (wasCorrect ? 1 : 0) >= targetCount) {
          setSessionComplete(true);
          return;
        }

        const nextRaw = currentIndex + 1;

        if (nextRaw >= queueItems.length) {
          if (isPractice) {
            if (queueItems.length > 1) {
              setCurrentIndex(0);
            } else {
              setSessionComplete(true);
            }
          } else if (hasMore) {
            const moreCards = await fetchDueCards();
            if (moreCards.length === 0) {
              setHasMore(false);
              setAllCaughtUp(true);
              return;
            }
            setQueueItems(moreCards.map((c) => ({ card: c, priority: 100 })));
            setHasMore(moreCards.length >= BATCH_SIZE);
            setCurrentIndex(0);
          } else {
            setAllCaughtUp(true);
            return;
          }
        } else {
          setCurrentIndex(nextRaw);
        }

        setFlipped(false);

        if (!isPractice) {
          const remaining = queueItems.length - currentIndex;
          if (remaining <= REFILL_THRESHOLD) {
            refillQueue();
          }
        }
      } finally {
        processingRef.current = false;
      }
    },
    [queueItems, currentIndex, correctCount, isLimited, targetCount, hasMore, fetchDueCards, refillQueue, isPractice, sendBatchUpdate, _localSM2],
  );

  const currentCard = queueItems[currentIndex]?.card ?? null;

  const backUrl = mode === 'quick' ? '/app' : isPractice ? '/app/flashcards/practice' : '/app/flashcards/study';

  const handlePracticeAgain = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleBackToSetup = useCallback(async () => {
    await sendBatchUpdate();
    router.push(backUrl);
  }, [sendBatchUpdate, router, backUrl]);

  const flippedRef = useRef(flipped);
  const terminalRef = useRef(sessionComplete || allCaughtUp);
  const noCardRef = useRef(!currentCard);
  const handleAnswerRef = useRef(handleAnswer);
  const toastShownRef = useRef(false);

  useEffect(() => {
    if (!toastShownRef.current) {
      toastShownRef.current = true;
      toast(t('shortcut_toast'), { duration: 3000 });
    }
  }, [t]);

  useEffect(() => { flippedRef.current = flipped; }, [flipped]);
  useEffect(() => { terminalRef.current = sessionComplete || allCaughtUp; }, [sessionComplete, allCaughtUp]);
  useEffect(() => { noCardRef.current = !currentCard; }, [currentCard]);
  useEffect(() => { handleAnswerRef.current = handleAnswer; }, [handleAnswer]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (terminalRef.current || noCardRef.current) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setFlipped((prev) => !prev);
        return;
      }

      if (!flippedRef.current) return;

      switch (e.key) {
        case '1': handleAnswerRef.current(false, 1); break;
        case '2': handleAnswerRef.current(false, 3); break;
        case '3': handleAnswerRef.current(true, 3); break;
        case '4': handleAnswerRef.current(true, 5); break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (summaryData) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <SessionSummaryDialog
          data={summaryData}
          onPracticeAgain={sessionComplete && !allCaughtUp ? handlePracticeAgain : undefined}
          onBackToSetup={handleBackToSetup}
        />
      </div>
    );
  }

  if (!currentCard) {
    return <div className="flex justify-center py-12">{t('no_flashcards_available')}</div>;
  }

  const progress = isLimited ? (correctCount / targetCount) * 100 : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Breadcrumbs items={[
          { label: navT('title'), href: '/app/flashcards' },
          { label: isPractice ? t('mode_practice') : t('mode_study'), href: backUrl },
          { label: t('breadcrumb_session'), href: '#' },
        ]} />
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {t('correct_badge', { correct: correctCount, total: totalAnswered })}
          </Badge>
          {isLimited && (
            <Badge>
              {t('remembered_badge', { correct: correctCount, target: targetCount })}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={async () => { await sendBatchUpdate(); router.push(backUrl); }}>
            <ArrowLeft className="mr-2 h-4 w-4" /> {t('exit_session')}
          </Button>
        </div>
      </div>

      {isLimited && <Progress value={progress} />}

      <Tooltip>
        <TooltipTrigger asChild>
          <Card
            className="cursor-pointer min-h-64 flex items-center justify-center transition-all duration-300 hover:shadow-lg"
            onClick={() => setFlipped(!flipped)}
            aria-keyshortcuts="Space"
          >
            <CardContent className="pt-8 px-8 text-center">
              <p className="text-xs text-muted-foreground uppercase mb-4">
                {flipped ? t('answer_label') : t('question_label')}
              </p>
              <div className="text-2xl font-medium grid">
                <div className={`[grid-area:1/1] ${flipped ? 'invisible' : ''}`}>
                  <MarkdownRenderer content={currentCard.front} />
                </div>
                <div className={`[grid-area:1/1] ${flipped ? '' : 'invisible'}`}>
                  <MarkdownRenderer content={currentCard.back} />
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                {t('click_hint', { action: flipped ? t('see_question') : t('reveal_answer') })}
              </p>
            </CardContent>
          </Card>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('shortcut_flip')}</TooltipContent>
      </Tooltip>

      <div className={`grid grid-cols-2 gap-2 transition-opacity duration-150 ${
        flipped ? '' : 'pointer-events-none opacity-30'
      }`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={() => handleAnswer(false, 1)} aria-keyshortcuts="1">
              <X className="mr-1.5 h-4 w-4 text-red-500" /> {t('rating_again')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('shortcut_again')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={() => handleAnswer(false, 3)} aria-keyshortcuts="2">
              <Minus className="mr-1.5 h-4 w-4 text-orange-500" /> {t('rating_hard')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('shortcut_hard')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={() => handleAnswer(true, 3)} aria-keyshortcuts="3">
              <Check className="mr-1.5 h-4 w-4 text-amber-500" /> {t('rating_good')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('shortcut_good')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={() => handleAnswer(true, 5)} aria-keyshortcuts="4">
              <Zap className="mr-1.5 h-4 w-4 text-green-500" /> {t('rating_easy')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('shortcut_easy')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
