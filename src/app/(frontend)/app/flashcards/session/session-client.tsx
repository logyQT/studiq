'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Check, X, ArrowLeft, RotateCcw, Minus, Zap } from 'lucide-react';

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

interface LocalSM2State {
  interval: number;
  easeFactor: number;
  repetitions: number;
  correctStreak: number;
}

const BATCH_SIZE = 20;
const REFILL_THRESHOLD = 5;
const PRACTICE_SKIP_THRESHOLD = 2;
const PRACTICE_SKIP_ROUNDS = 5;

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

interface SessionClientProps {
  initialCards: Flashcard[];
  mode: string;
  studyMode: string;
  targetCount: number;
  hasMore: boolean;
}

export default function SessionClient({ initialCards, mode, studyMode, targetCount, hasMore: initialHasMore }: SessionClientProps) {
  const t = useTranslations('AppFlashcardSessionPage');
  const router = useRouter();

  const isPractice = mode === 'practice';
  const isStudy = mode === 'study';
  const isLimited = studyMode === 'limited';

  const sessionIdRef = useRef<string>(generateUUID());
  const processingRef = useRef(false);
  const answeredCountRef = useRef(0);
  const pendingUpdatesRef = useRef<Array<{ flashcardId: string; wasCorrect: boolean; confidenceLevel: number }>>([]);

  const [queue, setQueue] = useState<Flashcard[]>(() => [...initialCards].sort(() => Math.random() - 0.5));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [allCaughtUp, setAllCaughtUp] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);

  const [_localSM2, setLocalSM2] = useState<Map<string, LocalSM2State>>(() => {
    if (isPractice) {
      const m = new Map<string, LocalSM2State>();
      initialCards.forEach((c) => m.set(c.id, { interval: 1, easeFactor: 2.5, repetitions: 0, correctStreak: 0 }));
      return m;
    }
    return new Map();
  });

  const [_skipMap, setSkipMap] = useState<Map<string, number>>(new Map());

  const fetchDueCards = useCallback(async (): Promise<Flashcard[]> => {
    try {
      const res = await fetch(`/api/v1/flashcards/practice/due?limit=${BATCH_SIZE}`);
      if (!res.ok) return [];
      const body = await res.json();
      return (body.data ?? []).map((card: { id: string; front: string; back: string }) => ({
        id: card.id,
        front: card.front,
        back: card.back,
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
      await fetch('/api/v1/flashcards/practice/batch', {
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
    if (!isStudy) return;
    const interval = setInterval(() => {
      sendBatchUpdate();
    }, 30_000);
    return () => clearInterval(interval);
  }, [isStudy, sendBatchUpdate]);

  const refillQueue = useCallback(async () => {
    if (!hasMore || isPractice) return;
    const moreCards = await fetchDueCards();
    if (moreCards.length === 0) {
      setHasMore(false);
      return;
    }
    setQueue((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const unique = moreCards.filter((c) => !existingIds.has(c.id));
      return [...prev, ...unique];
    });
    if (moreCards.length < BATCH_SIZE) {
      setHasMore(false);
    }
  }, [fetchDueCards, hasMore, isPractice]);

  const findNextVisibleIndex = useCallback((fromIndex: number, currentQueue: Flashcard[], currentSkipMap: Map<string, number>): number => {
    if (!isPractice) return fromIndex;
    for (let i = fromIndex; i < currentQueue.length; i++) {
      const skip = currentSkipMap.get(currentQueue[i]?.id);
      if (!skip || skip <= 0) return i;
    }
    return -1;
  }, [isPractice]);

  const handleAnswer = useCallback(
    async (wasCorrect: boolean, confidenceLevel: number) => {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        const currentCard = queue[currentIndex];
        if (!currentCard) return;

        if (isStudy) {
          pendingUpdatesRef.current.push({ flashcardId: currentCard.id, wasCorrect, confidenceLevel });
          answeredCountRef.current++;
          if (answeredCountRef.current >= 10) {
            answeredCountRef.current = 0;
            await sendBatchUpdate();
          }
        }

        if (isPractice) {
          setLocalSM2((prev) => {
            const state = prev.get(currentCard.id) ?? { interval: 1, easeFactor: 2.5, repetitions: 0, correctStreak: 0 };
            const newState = calculateSM2(state, confidenceLevel);
            const updated = new Map(prev);
            updated.set(currentCard.id, newState);

            if (newState.correctStreak >= PRACTICE_SKIP_THRESHOLD) {
              setSkipMap((skipPrev) => {
                const newSkip = new Map(skipPrev);
                newSkip.set(currentCard.id, PRACTICE_SKIP_ROUNDS);
                return newSkip;
              });
            }

            return updated;
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

        if (nextRaw >= queue.length) {
          if (hasMore && !isPractice) {
            const moreCards = await fetchDueCards();
            if (moreCards.length === 0) {
              setHasMore(false);
              if (isStudy) setAllCaughtUp(true);
              else setSessionComplete(true);
              return;
            }
            setQueue(moreCards);
            setHasMore(moreCards.length >= BATCH_SIZE);
            setCurrentIndex(0);
          } else {
            if (isStudy) setAllCaughtUp(true);
            else setSessionComplete(true);
            return;
          }
        } else {
          setSkipMap((prev) => {
            const nextIdx = findNextVisibleIndex(nextRaw, queue, prev);
            if (nextIdx === -1) {
              if (isStudy) setAllCaughtUp(true);
              else setSessionComplete(true);
              return prev;
            }

            const newSkip = new Map(prev);
            const skip = newSkip.get(queue[nextIdx]?.id);
            if (skip && skip > 0) {
              newSkip.set(queue[nextIdx].id, skip - 1);
            }
            setCurrentIndex(nextIdx);
            return newSkip;
          });
        }

        setFlipped(false);

        if (!isPractice) {
          const remaining = queue.length - currentIndex;
          if (remaining <= REFILL_THRESHOLD) {
            refillQueue();
          }
        }
      } finally {
        processingRef.current = false;
      }
    },
    [queue, currentIndex, correctCount, isLimited, targetCount, hasMore, fetchDueCards, refillQueue, isPractice, isStudy, findNextVisibleIndex],
  );

  const currentCard = queue[currentIndex];

  const backUrl = mode === 'quick' ? '/app' : isPractice ? '/app/flashcards/practice' : '/app/flashcards/study';

  const flippedRef = useRef(flipped);
  const terminalRef = useRef(sessionComplete || allCaughtUp);
  const noCardRef = useRef(!currentCard);
  const handleAnswerRef = useRef(handleAnswer);

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

  if (allCaughtUp) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{t('all_caught_up')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-center space-y-4">
            <p className="text-lg">{t('no_due_cards_message')}</p>
            <p className="text-sm text-muted-foreground">
              {t('session_result', { correct: correctCount, total: totalAnswered })}
            </p>
          </CardContent>
          <CardFooter className="flex justify-center gap-3">
            <Button onClick={async () => { await sendBatchUpdate(); router.push(backUrl); }}>
              <ArrowLeft className="mr-2 h-4 w-4" /> {t('back_to_setup')}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (sessionComplete) {
    const percentage = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{t('session_complete_title')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-center space-y-4">
            <p
              className="text-5xl font-bold"
              style={{ color: percentage >= 70 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))' }}
            >
              {percentage}%
            </p>
            <p className="text-lg">
              {t('session_result', { correct: correctCount, total: totalAnswered })}
            </p>
          </CardContent>
          <CardFooter className="flex justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setCorrectCount(0);
                setTotalAnswered(0);
                setSessionComplete(false);
                setCurrentIndex(0);
                setFlipped(false);
                setHasMore(initialHasMore);
                setAllCaughtUp(false);
                setSkipMap(new Map());
                sessionIdRef.current = generateUUID();
                setQueue([...initialCards].sort(() => Math.random() - 0.5));
              }}
            >
              <RotateCcw className="mr-2 h-4 w-4" /> {t('practice_again')}
            </Button>
            <Button onClick={async () => { await sendBatchUpdate(); router.push(backUrl); }}>
              <ArrowLeft className="mr-2 h-4 w-4" /> {t('back_to_setup')}
            </Button>
          </CardFooter>
        </Card>
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
        <Button variant="outline" size="sm" onClick={async () => { await sendBatchUpdate(); router.push(backUrl); }}>
          <ArrowLeft className="mr-2 h-4 w-4" /> {t('exit_session')}
        </Button>
        <div className="flex items-center gap-4">
          <Badge variant="outline">
            {t('correct_badge', { correct: correctCount, total: totalAnswered })}
          </Badge>
          {isLimited && (
            <Badge>
              {t('remembered_badge', { correct: correctCount, target: targetCount })}
            </Badge>
          )}
        </div>
      </div>

      {isLimited && <Progress value={progress} />}

      <Card
        className="cursor-pointer min-h-64 flex items-center justify-center transition-all duration-300 hover:shadow-lg"
        onClick={() => setFlipped(!flipped)}
        aria-keyshortcuts="Space"
      >
        <CardContent className="pt-8 text-center px-8">
          <p className="text-xs text-muted-foreground uppercase mb-4">
            {flipped ? t('answer_label') : t('question_label')}
          </p>
          <p className="text-2xl font-medium">{flipped ? currentCard.back : currentCard.front}</p>
          <p className="text-sm text-muted-foreground mt-4">
            {t('click_hint', { action: flipped ? t('see_question') : t('reveal_answer') })}
          </p>
        </CardContent>
      </Card>

      {flipped && (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => handleAnswer(false, 1)} aria-keyshortcuts="1">
            <X className="mr-1.5 h-4 w-4 text-red-500" /> {t('rating_again')}
          </Button>
          <Button onClick={() => handleAnswer(false, 3)} aria-keyshortcuts="2">
            <Minus className="mr-1.5 h-4 w-4 text-orange-500" /> {t('rating_hard')}
          </Button>
          <Button onClick={() => handleAnswer(true, 3)} aria-keyshortcuts="3">
            <Check className="mr-1.5 h-4 w-4 text-amber-500" /> {t('rating_good')}
          </Button>
          <Button onClick={() => handleAnswer(true, 5)} aria-keyshortcuts="4">
            <Zap className="mr-1.5 h-4 w-4 text-green-500" /> {t('rating_easy')}
          </Button>
        </div>
      )}
    </div>
  );
}
