'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Progress,
} from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Brain, Check, Loader2, Minus, X, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashcardFlip } from '@/components/flashcards/flashcard-flip';
import { SessionSummaryDialog } from '@/components/flashcards/session-summary-dialog';
import { KeyboardShortcutsPanel } from '@/components/shared/keyboard-shortcuts-panel';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { applyCramAction, cramActionForRating } from '@/lib/cram-queue';
import { formatDateTime } from '@/lib/datetime';
import { flashcardKeys } from '@/lib/query-keys';
import { overlayOpen } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';

interface Flashcard {
  id: string;
  front: string;
  back: string;
  createdAt: string | null;
  deckName: string | null;
  topicNames: string[];
  reviewState: Record<string, unknown> | null;
}

interface CardStateInfo {
  label: string;
  labelKey: string;
  isLeech: boolean;
  step?: number;
}

const SESSION_TYPE_CONFIG = {
  review: { mode: 'review', studyMode: 'endless' },
  new: { mode: 'review', studyMode: 'endless' },
  cram: { mode: 'cram', studyMode: 'unlimited' },
} as const;

function getCardStateInfo(
  card: Flashcard | null,
  t: (key: string, params?: Record<string, string | number | Date>) => string,
): CardStateInfo {
  if (!card) return { label: '', labelKey: '', isLeech: false };

  const rs = card.reviewState;
  if (!rs) return { label: t('card_state_new'), labelKey: 'card_state_new', isLeech: false };

  const isLeech = !!rs.isLeech;
  if (isLeech) {
    return {
      label: t('card_state_leech'),
      labelKey: 'card_state_leech',
      isLeech: true,
      step: rs.learningStep as number,
    };
  }

  const ls = rs.learningState as string;
  const step = rs.learningStep as number;

  if (ls === 'learning')
    return {
      label: t('card_state_learning'),
      labelKey: 'card_state_learning',
      isLeech: false,
      step,
    };
  if (ls === 'relearning')
    return {
      label: t('card_state_relearning'),
      labelKey: 'card_state_relearning',
      isLeech: false,
      step,
    };
  if (ls === 'review')
    return { label: t('card_state_review'), labelKey: 'card_state_review', isLeech: false };

  return { label: t('card_state_new'), labelKey: 'card_state_new', isLeech: false };
}

const BATCH_SIZE = 20;
const REFILL_THRESHOLD = 5;
/** Longest session the API accepts (CompleteSessionSchema). */
const MAX_SESSION_MS = 7_200_000;

function generateUUID(): string {
  return crypto.randomUUID();
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function mapCards(data: unknown[]): Flashcard[] {
  return (data ?? []).map((item) => {
    const fc = item as {
      id: string;
      front: string;
      back: string;
      createdAt?: string | null;
      deckName?: string | null;
      topicNames?: string[];
      reviewState?: Record<string, unknown> | null;
    };
    return {
      id: fc.id,
      front: fc.front,
      back: fc.back,
      createdAt: fc.createdAt ?? null,
      deckName: fc.deckName ?? null,
      topicNames: fc.topicNames ?? [],
      reviewState: fc.reviewState ?? null,
    };
  });
}

interface SessionClientProps {
  type: string;
  studyMode?: string;
  deckId?: string;
  topics?: string;
  decks?: string;
  target?: string;
  limit?: string;
}

export default function SessionClient(props: SessionClientProps) {
  const t = useTranslations('AppFlashcardSessionPage');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();

  const config =
    SESSION_TYPE_CONFIG[props.type as keyof typeof SESSION_TYPE_CONFIG] ??
    SESSION_TYPE_CONFIG.review;
  const mode = config.mode;
  const isCram = mode === 'cram';
  const isNew = props.type === 'new';
  const studyMode = props.studyMode || config.studyMode;
  const isLimited = studyMode === 'limited';
  const targetCount = parseInt(props.target || '10', 10);
  const batchSize = 20;
  const deckIds = useMemo(
    () => (props.deckId ? [props.deckId] : (props.decks?.split(',').filter(Boolean) ?? [])),
    [props.deckId, props.decks],
  );
  const topicIds = useMemo(() => props.topics?.split(',').filter(Boolean) ?? [], [props.topics]);

  const sessionIdRef = useRef<string>(generateUUID());
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const processingRef = useRef(false);
  const answeredCountRef = useRef(0);
  const pendingUpdatesRef = useRef<
    Array<{ flashcardId: string; wasCorrect: boolean; confidenceLevel: number }>
  >([]);
  const hasFinalisedRef = useRef(false);
  const leechedCardIdsRef = useRef<Set<string>>(new Set());
  const [suspendedIds, setSuspendedIds] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<Flashcard[]>([]);
  /**
   * Cram's working queue, consumed from the front. `cards` stays the immutable
   * shuffled deck (also the "deck loaded / non-empty" source) so that
   * „Wkuj ponownie" can rebuild the queue without re-fetching (#617).
   */
  const [cramQueue, setCramQueue] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [exitDirection, setExitDirection] = useState<'left' | 'right'>('right');
  const [correctCount, setCorrectCount] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [allCaughtUp, setAllCaughtUp] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [summaryData, setSummaryData] = useState<{
    cardsStudied: number;
    cardsCorrect: number;
    durationMs: number;
    mode: string;
  } | null>(null);
  const [leechDialogCardId, setLeechDialogCardId] = useState<string | null>(null);
  const [leechDialogResolve, setLeechDialogResolve] = useState<
    ((action: 'suspend' | 'keep') => void) | null
  >(null);

  useEffect(() => {
    if (isCram && !props.deckId) router.replace('/app/study/cram');
  }, [isCram, props.deckId, router]);

  useEffect(() => {
    let cancelled = false;
    const fetchInitial = async () => {
      // `/app/study/session/cram` without a deck has no queue to cram. The
      // redirect effect above sends the user to the deck picker; returning here
      // keeps the loader up (and avoids loading due cards in cram mode).
      if (isCram && !props.deckId) return;
      setLoading(true);
      setError(null);
      try {
        if (isCram && props.deckId) {
          const res = await fetch(`/api/v1/flashcards/practice/prepare?deckIds=${props.deckId}`);
          if (!res.ok) {
            setError('FETCH_FAILED');
            return;
          }
          const body = await res.json();
          if (cancelled) return;
          const shuffled = shuffleArray(mapCards(body.data));
          setCards(shuffled);
          setCramQueue(shuffled);
          setHasMore(false);
        } else {
          const params = new URLSearchParams();
          params.set('limit', String(batchSize));
          if (deckIds.length > 0) params.set('deckIds', deckIds.join(','));
          if (topicIds.length > 0) params.set('topicIds', topicIds.join(','));
          const endpoint = isNew ? 'new' : 'review';
          const res = await fetch(`/api/v1/flashcards/practice/${endpoint}?${params.toString()}`);
          if (!res.ok) {
            setError('FETCH_FAILED');
            return;
          }
          const body = await res.json();
          if (cancelled) return;
          const mapped = mapCards(body.data);
          setCards(shuffleArray(mapped));
          setHasMore(mapped.length >= batchSize);
        }
        if (!cancelled) setLoaded(true);
      } catch {
        if (!cancelled) setError('FETCH_FAILED');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchInitial();
    return () => {
      cancelled = true;
    };
  }, [isCram, props.deckId, deckIds, topicIds, isNew]);

  const visibleCards = useMemo(
    () => cards.filter((c) => !suspendedIds.has(c.id)),
    [cards, suspendedIds],
  );

  const currentCard = isCram ? (cramQueue[0] ?? null) : (visibleCards[currentIndex] ?? null);
  const cardState = useMemo(() => getCardStateInfo(currentCard, t), [currentCard, t]);

  const fetchDueCards = useCallback(async (): Promise<Flashcard[]> => {
    try {
      const params = new URLSearchParams();
      params.set('limit', String(BATCH_SIZE));
      if (deckIds.length > 0) params.set('deckIds', deckIds.join(','));
      if (topicIds.length > 0) params.set('topicIds', topicIds.join(','));
      const endpoint = isNew ? 'new' : 'review';
      const res = await fetch(`/api/v1/flashcards/practice/${endpoint}?${params.toString()}`);
      if (!res.ok) return [];
      const body = await res.json();
      return mapCards(body.data);
    } catch {
      return [];
    }
  }, [deckIds, topicIds, isNew]);

  const sendBatchUpdate = useCallback(async () => {
    if (pendingUpdatesRef.current.length === 0) return;
    const batch = [...pendingUpdatesRef.current];
    pendingUpdatesRef.current = [];
    try {
      const res = await fetch('/api/v1/flashcards/batch/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Request-level mode (#617): cram is side-effect-free server-side, so
          // the request stays (defence in depth) but writes nothing.
          mode,
          items: batch.map((b) => ({ ...b, sessionId: sessionIdRef.current })),
        }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.data?.results) {
          for (const r of body.data.results) {
            if (r.isLeech) {
              leechedCardIdsRef.current.add(r.flashcardId);
            }
          }
        }
      } else {
        console.error('[sendBatchUpdate] server returned', res.status);
        pendingUpdatesRef.current.unshift(...batch);
      }
    } catch {
      pendingUpdatesRef.current.unshift(...batch);
    }
  }, [mode]);

  const showLeechDialog = useCallback((cardId: string): Promise<'suspend' | 'keep'> => {
    return new Promise((resolve) => {
      setLeechDialogCardId(cardId);
      setLeechDialogResolve(() => resolve);
    });
  }, []);

  const handleLeechAction = useCallback(
    (action: 'suspend' | 'keep') => {
      leechDialogResolve?.(action);
      setLeechDialogCardId(null);
      setLeechDialogResolve(null);
    },
    [leechDialogResolve],
  );

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

    // A tab left open overnight is not a 20-hour session; the API refuses more than two hours.
    const durationMs = Math.min(Date.now() - startedAt, MAX_SESSION_MS);

    const finalise = async () => {
      await sendBatchUpdate();

      const modeStr = isCram ? 'cram' : 'review';

      setSummaryData({
        cardsStudied: totalAnswered,
        cardsCorrect: correctCount,
        durationMs,
        mode: modeStr,
      });

      await fetch('/api/v1/flashcards/practice/sessions/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs,
          cardsStudied: totalAnswered,
          cardsCorrect: correctCount,
          deckIds: deckIds ?? [],
          mode: modeStr,
        }),
      }).catch(() => {});

      // The statistics and due counts were cached before this session; without this the student
      // lands back on /app/stats/content with the pre-session numbers (#365).
      for (const queryKey of flashcardKeys.afterStudySession) {
        queryClient.invalidateQueries({ queryKey });
      }
    };

    finalise();
  }, [
    sessionComplete,
    allCaughtUp,
    totalAnswered,
    correctCount,
    startedAt,
    isCram,
    deckIds,
    sendBatchUpdate,
    queryClient,
  ]);

  const refillQueue = useCallback(async () => {
    if (!hasMore || isCram) return;
    const moreCards = await fetchDueCards();
    if (moreCards.length === 0) {
      setHasMore(false);
      return;
    }
    setCards((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const unique = moreCards.filter((c) => !existingIds.has(c.id));
      return [...prev, ...unique];
    });
    if (moreCards.length < BATCH_SIZE) {
      setHasMore(false);
    }
  }, [fetchDueCards, hasMore, isCram]);

  const advanceCard = useCallback(async () => {
    const nextRaw = visibleCards.findIndex((c, i) => i > currentIndex && !suspendedIds.has(c.id));
    if (nextRaw !== -1) {
      setCurrentIndex(nextRaw);
      setFlipped(false);
      return;
    }

    if (hasMore) {
      const moreCards = await fetchDueCards();
      if (moreCards.length === 0) {
        setHasMore(false);
        setAllCaughtUp(true);
        return;
      }
      setCards(moreCards);
      setHasMore(moreCards.length >= BATCH_SIZE);
      setCurrentIndex(0);
      setFlipped(false);
    } else {
      setAllCaughtUp(true);
    }
  }, [visibleCards, currentIndex, hasMore, fetchDueCards, suspendedIds]);

  const handleAnswer = useCallback(
    async (wasCorrect: boolean, confidenceLevel: number) => {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        const card = currentCard;
        if (!card) return;

        pendingUpdatesRef.current.push({ flashcardId: card.id, wasCorrect, confidenceLevel });
        answeredCountRef.current++;
        if (answeredCountRef.current >= 10) {
          answeredCountRef.current = 0;
          await sendBatchUpdate();
        }

        setTotalAnswered((prev) => prev + 1);
        if (wasCorrect) {
          setCorrectCount((prev) => prev + 1);
        }

        if (isLimited && correctCount + (wasCorrect ? 1 : 0) >= targetCount) {
          setSessionComplete(true);
          return;
        }

        setExitDirection(confidenceLevel <= 2 ? 'left' : 'right');

        if (isCram) {
          const nextQueue = applyCramAction(cramQueue, cramActionForRating(confidenceLevel));
          if (nextQueue.length === 0) {
            setCramQueue(nextQueue);
            setSessionComplete(true);
            return;
          }
          setCramQueue(nextQueue);
          setFlipped(false);
          return;
        }

        await advanceCard();

        const remaining = visibleCards.filter((c) => !suspendedIds.has(c.id)).length;
        if (remaining <= REFILL_THRESHOLD) {
          refillQueue();
        }
      } finally {
        processingRef.current = false;
      }
    },
    [
      currentCard,
      correctCount,
      isLimited,
      targetCount,
      isCram,
      cramQueue,
      sendBatchUpdate,
      advanceCard,
      refillQueue,
      visibleCards,
      suspendedIds,
    ],
  );

  useEffect(() => {
    // Cram has no scheduling effect, so a leech dialog would only block a deck
    // card behind a modal that cannot change anything (#617).
    if (isCram) return;
    if (!currentCard || leechDialogCardId) return;
    const id = currentCard.id;
    if (leechedCardIdsRef.current.has(id) || cardState.isLeech) {
      showLeechDialog(id).then((action) => {
        if (action === 'suspend') {
          setSuspendedIds((prev) => new Set(prev).add(id));
          advanceCard();
        }
      });
    }
  }, [
    isCram,
    currentCard?.id,
    currentCard,
    cardState.isLeech,
    leechDialogCardId,
    showLeechDialog,
    advanceCard,
  ]);

  const backUrl = isCram ? '/app/study/cram' : '/app/study';

  const handlePracticeAgain = useCallback(() => {
    if (!isCram) {
      router.refresh();
      return;
    }

    // Restart the same deck in place — no reload, no re-fetch. Each finished
    // round is its own flashcard_study_sessions row, hence the fresh session id.
    sessionIdRef.current = generateUUID();
    setStartedAt(Date.now());
    hasFinalisedRef.current = false;
    answeredCountRef.current = 0;
    pendingUpdatesRef.current = [];
    leechedCardIdsRef.current = new Set();
    setCramQueue(shuffleArray(cards));
    setCurrentIndex(0);
    setFlipped(false);
    setCorrectCount(0);
    setTotalAnswered(0);
    setSummaryData(null);
    setSessionComplete(false);
    setAllCaughtUp(false);
    setSuspendedIds(new Set());
  }, [isCram, cards, router]);

  const handleBackToSetup = useCallback(async () => {
    await sendBatchUpdate();
    router.push(backUrl);
  }, [sendBatchUpdate, router, backUrl]);

  const flippedRef = useRef(flipped);
  const terminalRef = useRef(sessionComplete || allCaughtUp);
  const noCardRef = useRef(!currentCard);
  const handleAnswerRef = useRef(handleAnswer);

  useEffect(() => {
    flippedRef.current = flipped;
  }, [flipped]);
  useEffect(() => {
    terminalRef.current = sessionComplete || allCaughtUp;
  }, [sessionComplete, allCaughtUp]);
  useEffect(() => {
    noCardRef.current = !currentCard;
  }, [currentCard]);
  useEffect(() => {
    handleAnswerRef.current = handleAnswer;
  }, [handleAnswer]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // The card's own handler (Enter/Space on a focused card, or a focused link) already acted and
      // consumed the key: never flip it back here.
      if (e.defaultPrevented) return;
      if (terminalRef.current || noCardRef.current) return;
      // Space and 1-4 rate and flip cards: never while a dialog or menu is on top (the shortcuts
      // list, a confirmation), where they would silently write a review.
      if (overlayOpen()) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) return;

      // A focused button owns Space (its native activation): the header's shortcuts button would
      // flip the card instead of opening the dialog. The other session keys still work.
      const onButton = tag === 'BUTTON' || active?.getAttribute('role') === 'button';
      if (onButton && (e.key === ' ' || e.code === 'Space')) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setFlipped((prev) => !prev);
        return;
      }

      if (e.key === 'p') {
        const audio = document.querySelector('audio') as HTMLAudioElement | null;
        if (audio) {
          if (audio.paused) {
            audio.play();
          } else {
            audio.pause();
          }
        }
        return;
      }

      if (!flippedRef.current) return;

      switch (e.key) {
        case '1':
          handleAnswerRef.current(false, 1);
          break;
        case '2':
          handleAnswerRef.current(false, 2);
          break;
        case '3':
          handleAnswerRef.current(true, 3);
          break;
        case '4':
          handleAnswerRef.current(true, 4);
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || (loaded && cards.length === 0)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-lg text-muted-foreground">{t('no_flashcards_available')}</p>
        <Button variant="outline" onClick={() => router.push(backUrl)}>
          <ArrowLeft data-icon="inline-start" /> {t('back_to_setup')}
        </Button>
      </div>
    );
  }

  if (summaryData) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <SessionSummaryDialog
          data={summaryData}
          queueExhausted={allCaughtUp}
          onPracticeAgain={sessionComplete && !allCaughtUp ? handlePracticeAgain : undefined}
          onBackToSetup={handleBackToSetup}
        />
      </div>
    );
  }

  if (!currentCard) {
    // A terminal session finalises asynchronously (batch flush → summary). Show
    // the loader so the brief card-less frame never reads „Brak dostępnych fiszek".
    if (sessionComplete || allCaughtUp) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      );
    }
    return <div className="flex justify-center py-12">{t('no_flashcards_available')}</div>;
  }

  const progress = isLimited ? (correctCount / targetCount) * 100 : 0;
  const isLearningState =
    cardState.labelKey === 'card_state_learning' ||
    cardState.labelKey === 'card_state_relearning' ||
    cardState.labelKey === 'card_state_new';

  // Cram's four actions are mode-defined, not card-state-defined (#617), so the
  // labels follow the session mode — the mapping itself lives in `cram-queue.ts`.
  const ratingLabels = isCram
    ? {
        again: t('rating_again_cram'),
        hard: t('rating_hard_cram'),
        good: t('rating_good_cram'),
        easy: t('rating_easy_cram'),
      }
    : isLearningState
      ? {
          again: t('rating_again_learning'),
          hard: t('rating_hard_learning'),
          good: t('rating_good_learning'),
          easy: t('rating_easy_learning'),
        }
      : {
          again: t('rating_again'),
          hard: t('rating_hard'),
          good: t('rating_good'),
          easy: t('rating_easy'),
        };

  const reviewState = currentCard.reviewState as {
    nextReviewAt?: string | null;
    intervalValue?: number | null;
    intervalUnit?: string | null;
  } | null;
  const nextReviewAt = reviewState?.nextReviewAt ?? null;
  const nextReviewInterval =
    reviewState?.intervalValue == null || !reviewState.intervalUnit
      ? null
      : reviewState.intervalUnit === 'minutes'
        ? t('interval_minutes', { count: reviewState.intervalValue })
        : t('interval_days', { count: reviewState.intervalValue });

  return (
    <>
      <AlertDialog open={leechDialogCardId !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('leech_dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('leech_dialog_description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleLeechAction('keep')}>
              {t('leech_keep')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => handleLeechAction('suspend')}>
              {t('leech_suspend')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mx-auto flex max-w-2xl min-h-full flex-col">
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {cardState.labelKey !== 'card_state_review' && cardState.labelKey !== '' && (
                <Badge variant={cardState.isLeech ? 'destructive' : 'secondary'}>
                  {cardState.isLeech && <Brain className="mr-1 size-3" />}
                  {cardState.label}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {t('correct_badge', { correct: correctCount, total: totalAnswered })}
              </Badge>
              {isLimited && (
                <Badge>
                  {t('remembered_badge', { correct: correctCount, target: targetCount })}
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await sendBatchUpdate();
                  router.push(backUrl);
                }}
              >
                <ArrowLeft data-icon="inline-start" /> {t('exit_session')}
              </Button>
            </div>
          </div>

          {isLimited && <Progress value={progress} />}

          {(currentCard.deckName || currentCard.topicNames.length > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {currentCard.deckName && (
                <Badge variant="outline" className="text-xs font-normal">
                  {currentCard.deckName}
                </Badge>
              )}
              {currentCard.topicNames.map((topic) => (
                <Badge key={topic} variant="secondary" className="text-xs font-normal">
                  {topic}
                </Badge>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait" custom={exitDirection}>
            <motion.div
              key={currentCard.id}
              custom={exitDirection}
              variants={{
                initial: (direction: string) => ({
                  rotate: -10,
                  y: 60,
                  opacity: 0,
                  transformOrigin: direction === 'left' ? 'left center' : 'right center',
                }),
                animate: (direction: string) => ({
                  rotate: 0,
                  y: 0,
                  opacity: 1,
                  transformOrigin: direction === 'left' ? 'left center' : 'right center',
                }),
                exit: (direction: string) => ({
                  rotate: direction === 'left' ? -15 : 15,
                  x: direction === 'left' ? -200 : 80,
                  opacity: 0,
                  transformOrigin: direction === 'left' ? 'left center' : 'right center',
                  transition: { duration: direction === 'left' ? 0.2 : 0.15, ease: 'easeIn' },
                }),
              }}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 25,
              }}
            >
              <FlashcardFlip
                isFlipped={flipped}
                onClick={() => {
                  // The card keeps focus when the shortcuts panel opens; never flip it behind a layer.
                  if (overlayOpen()) return;
                  setFlipped((prev) => !prev);
                }}
                ariaLabel={t('flashcard_aria')}
                className="cursor-pointer max-h-[32rem]"
                front={
                  <>
                    <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
                      <div className="flex h-[200%] w-[200%] rotate-[45deg] flex-col items-center justify-center gap-y-16 opacity-[0.02]">
                        {Array.from({ length: 24 }).map((_, rowIndex) => (
                          <div
                            key={rowIndex}
                            className={cn(
                              'flex items-center gap-x-16',
                              rowIndex % 2 === 0 ? 'translate-x-8' : '',
                            )}
                          >
                            {Array.from({ length: 24 }).map((_, colIndex) => (
                              <span
                                key={colIndex}
                                className="-rotate-45 text-5xl font-bold select-none"
                              >
                                ?
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="relative z-10 flex w-full flex-1 items-center justify-center overflow-y-auto px-8 text-center text-2xl font-medium">
                      <MarkdownRenderer content={currentCard.front} />
                    </div>
                  </>
                }
                back={
                  <>
                    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" />
                    <div className="relative z-10 flex w-full flex-1 items-center justify-center overflow-y-auto px-8 text-center text-2xl font-medium">
                      <MarkdownRenderer content={currentCard.back} />
                    </div>
                  </>
                }
              />
            </motion.div>
          </AnimatePresence>

          {!flipped && (
            <p className="text-center text-sm text-muted-foreground">
              {t('click_hint', { action: t('reveal_answer') })}
            </p>
          )}

          {!isCram && isLearningState && (
            <div className="text-center text-sm text-muted-foreground">
              {t('step_indicator', { step: (cardState.step ?? 0) + 1 })}
            </div>
          )}

          {nextReviewAt && (
            <p className="text-center text-xs text-muted-foreground">
              {t('next_review_line', {
                date: formatDateTime(nextReviewAt, locale),
                interval: nextReviewInterval ?? '--',
              })}
            </p>
          )}

          <div
            className={cn(
              'grid grid-cols-2 gap-2 transition-opacity duration-150',
              flipped ? '' : 'pointer-events-none opacity-30',
            )}
          >
            <Button
              variant="ghost"
              onClick={() => handleAnswer(false, 1)}
              aria-keyshortcuts="1"
              style={{ boxShadow: '0 0 8px rgba(239,68,68,0.12)' }}
            >
              <X className="mr-1.5 size-4 text-red-500" /> {ratingLabels.again}
            </Button>
            <Button
              variant="ghost"
              onClick={() => handleAnswer(true, 3)}
              aria-keyshortcuts="3"
              style={{ boxShadow: '0 0 8px rgba(217,119,6,0.12)' }}
            >
              <Check className="mr-1.5 size-4 text-amber-500" /> {ratingLabels.good}
            </Button>
            <Button
              variant="ghost"
              onClick={() => handleAnswer(false, 2)}
              aria-keyshortcuts="2"
              style={{ boxShadow: '0 0 8px rgba(249,115,22,0.12)' }}
            >
              <Minus className="mr-1.5 size-4 text-orange-500" /> {ratingLabels.hard}
            </Button>
            <Button
              variant="ghost"
              onClick={() => handleAnswer(true, 4)}
              aria-keyshortcuts="4"
              style={{ boxShadow: '0 0 8px rgba(34,197,94,0.12)' }}
            >
              <Zap className="mr-1.5 size-4 text-green-500" /> {ratingLabels.easy}
            </Button>
          </div>
        </div>

        <KeyboardShortcutsPanel
          shortcuts={[
            { key: 'Space', label: t('rating_flip') },
            { key: 'p', label: t('play_audio') },
            { key: '1', label: ratingLabels.again },
            { key: '2', label: ratingLabels.hard },
            { key: '3', label: ratingLabels.good },
            { key: '4', label: ratingLabels.easy },
          ]}
        />
      </div>
    </>
  );
}
