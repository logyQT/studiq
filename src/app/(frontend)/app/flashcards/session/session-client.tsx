'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Check, X, ArrowLeft, Minus, Zap, Brain } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SessionSummaryDialog } from '@/components/flashcards/session-summary-dialog';
import { FlashcardFlip } from '@/components/flashcards/flashcard-flip';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { KeyboardShortcutsPanel } from '@/components/shared/keyboard-shortcuts-panel';
import { AnimatePresence, motion } from 'motion/react';

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

function getCardStateInfo(
  card: Flashcard | null,
  t: (key: string, params?: any) => string,
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

interface SessionClientProps {
  initialCards: Flashcard[];
  mode: string;
  studyMode: string;
  targetCount: number;
  hasMore: boolean;
  deckIds?: string[];
}

export default function SessionClient({
  initialCards,
  mode,
  studyMode,
  targetCount,
  hasMore: initialHasMore,
  deckIds,
}: SessionClientProps) {
  const t = useTranslations('AppFlashcardSessionPage');
  const router = useRouter();

  const isCram = mode === 'cram';
  const isReview = mode === 'review';
  const isLimited = studyMode === 'limited';

  const sessionIdRef = useRef<string>(generateUUID());
  const [startedAt] = useState(() => Date.now());
  const processingRef = useRef(false);
  const answeredCountRef = useRef(0);
  const pendingUpdatesRef = useRef<
    Array<{ flashcardId: string; wasCorrect: boolean; confidenceLevel: number }>
  >([]);
  const hasFinalisedRef = useRef(false);
  const leechedCardIdsRef = useRef<Set<string>>(new Set());
  const suspendedIdsRef = useRef<Set<string>>(new Set());

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
  const [leechDialogCardId, setLeechDialogCardId] = useState<string | null>(null);
  const [leechDialogResolve, setLeechDialogResolve] = useState<
    ((action: 'suspend' | 'keep') => void) | null
  >(null);

  const [cards, setCards] = useState<Flashcard[]>(() => {
    return shuffleArray(initialCards);
  });

  const visibleCards = useMemo(
    () => cards.filter((c) => !suspendedIdsRef.current.has(c.id)),
    [cards],
  );

  const currentCard = visibleCards[currentIndex] ?? null;
  const cardState = useMemo(() => getCardStateInfo(currentCard, t), [currentCard, t]);

  const fetchDueCards = useCallback(async (): Promise<Flashcard[]> => {
    try {
      const res = await fetch(`/api/v1/flashcards/practice/due?limit=${BATCH_SIZE}`);
      if (!res.ok) return [];
      const body = await res.json();
      return (body.data ?? []).map(
        (card: {
          id: string;
          front: string;
          back: string;
          createdAt?: string | null;
          deckName?: string | null;
          topicNames?: string[];
          reviewState?: Record<string, unknown> | null;
        }) => ({
          id: card.id,
          front: card.front,
          back: card.back,
          createdAt: card.createdAt ?? null,
          deckName: card.deckName ?? null,
          topicNames: card.topicNames ?? [],
          reviewState: card.reviewState ?? null,
        }),
      );
    } catch {
      return [];
    }
  }, []);

  const sendBatchUpdate = useCallback(async () => {
    if (pendingUpdatesRef.current.length === 0) return;
    const batch = [...pendingUpdatesRef.current];
    pendingUpdatesRef.current = [];
    try {
      const res = await fetch('/api/v1/flashcards/batch/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
      }
    } catch {
      pendingUpdatesRef.current.unshift(...batch);
    }
  }, []);

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

    const durationMs = Date.now() - startedAt;

    const finalise = async () => {
      await sendBatchUpdate();

      const modeStr = isCram ? 'cram' : isReview ? 'review' : 'quick';

      const sessionData = {
        sessionId: sessionIdRef.current,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        cardsStudied: totalAnswered,
        cardsCorrect: correctCount,
        deckIds: deckIds ?? [],
        mode: modeStr,
      };

      setSummaryData({
        cardsStudied: totalAnswered,
        cardsCorrect: correctCount,
        durationMs,
        mode: modeStr,
      });

      await fetch('/api/v1/flashcards/practice/sessions/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData),
      }).catch(() => {});
    };

    finalise();
  }, [
    sessionComplete,
    allCaughtUp,
    totalAnswered,
    correctCount,
    isCram,
    isReview,
    deckIds,
    sendBatchUpdate,
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
    const nextRaw = visibleCards.findIndex(
      (c, i) => i > currentIndex && !suspendedIdsRef.current.has(c.id),
    );
    if (nextRaw !== -1) {
      setCurrentIndex(nextRaw);
      setFlipped(false);
      return;
    }

    if (isCram) {
      const anyUnsuspended = visibleCards.some((c) => !suspendedIdsRef.current.has(c.id));
      if (anyUnsuspended) {
        setCurrentIndex(0);
        setFlipped(false);
      } else {
        setSessionComplete(true);
      }
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
  }, [visibleCards, currentIndex, isCram, hasMore, fetchDueCards]);

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

        await advanceCard();

        if (!isCram) {
          const remaining = visibleCards.filter((c) => !suspendedIdsRef.current.has(c.id)).length;
          if (remaining <= REFILL_THRESHOLD) {
            refillQueue();
          }
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
      sendBatchUpdate,
      advanceCard,
      refillQueue,
      visibleCards,
    ],
  );

  useEffect(() => {
    if (!currentCard || leechDialogCardId) return;
    const id = currentCard.id;
    if (leechedCardIdsRef.current.has(id) || cardState.isLeech) {
      showLeechDialog(id).then((action) => {
        if (action === 'suspend') {
          suspendedIdsRef.current.add(id);
          setCards((prev) => [...prev]);
          advanceCard();
        }
      });
    }
  }, [currentCard?.id, cardState.isLeech, leechDialogCardId, showLeechDialog, advanceCard]);

  const backUrl = mode === 'quick' ? '/app' : '/app/flashcards/study';

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
      if (terminalRef.current || noCardRef.current) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setFlipped((prev) => !prev);
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
  const isLearningState =
    cardState.labelKey === 'card_state_learning' ||
    cardState.labelKey === 'card_state_relearning' ||
    cardState.labelKey === 'card_state_new';

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

      <div className="max-w-2xl mx-auto min-h-full flex flex-col">
        <div className="flex-1 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {cardState.labelKey !== 'card_state_review' && cardState.labelKey !== '' && (
                <Badge variant={cardState.isLeech ? 'destructive' : 'secondary'}>
                  {cardState.isLeech && <Brain className="mr-1 h-3 w-3" />}
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
                <ArrowLeft className="mr-2 h-4 w-4" /> {t('exit_session')}
              </Button>
            </div>
          </div>

          {isLimited && <Progress value={progress} />}

          {(currentCard.deckName || currentCard.topicNames.length > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
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

          <AnimatePresence mode="wait">
            <motion.div
              key={currentCard.id}
              initial={{ rotate: -10, y: 60, opacity: 0 }}
              animate={{ rotate: 0, y: 0, opacity: 1 }}
              exit={{
                rotate: 15,
                x: 80,
                opacity: 0,
                transition: { duration: 0.15, ease: 'easeIn' },
              }}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 25,
              }}
              style={{ transformOrigin: 'right center' }}
            >
              <FlashcardFlip
                isFlipped={flipped}
                onClick={() => setFlipped(!flipped)}
                className="cursor-pointer max-h-[32rem] transition-shadow duration-300 hover:shadow-lg"
                front={
                  <>
                    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 flex items-center justify-center">
                      {/* 1. Oversized container (200%) prevents the corners from being empty when rotated 
      2. rotate-45 angles the entire brick structure 
    */}
                      <div className="absolute w-[200%] h-[200%] flex flex-col items-center justify-center gap-y-16 rotate-[45deg] opacity-[0.02]">
                        {Array.from({ length: 24 }).map((_, rowIndex) => (
                          <div
                            key={rowIndex}
                            // Shift every even row to the right by exactly half the gap (gap-x-16 = 4rem, translate-x-8 = 2rem) to create the brick stagger
                            className={`flex items-center gap-x-16 ${
                              rowIndex % 2 === 0 ? 'translate-x-8' : ''
                            }`}
                          >
                            {Array.from({ length: 24 }).map((_, colIndex) => (
                              <span
                                key={colIndex}
                                // -rotate-45 counter-rotates the question marks so they stay perfectly upright while the grid is angled
                                className="text-5xl font-bold select-none -rotate-45"
                              >
                                ?
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="relative z-10 flex-1 flex items-center justify-center overflow-y-auto text-2xl font-medium w-full px-8">
                      <MarkdownRenderer content={currentCard.front} />
                    </div>
                  </>
                }
                back={
                  <>
                    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                      {/* TODO: answer watermark — up to debate whether to add one */}
                      {/* <div className="absolute -inset-20 grid grid-cols-6 gap-x-12 gap-y-16 opacity-[0.03]">
                    {Array.from({ length: 48 }).map((_, i) => (
                      <span key={i} className="text-5xl font-bold select-none">✓</span>
                    ))}
                  </div> */}
                    </div>
                    <div className="relative z-10 flex-1 flex items-center justify-center overflow-y-auto text-2xl font-medium w-full px-8">
                      <MarkdownRenderer content={currentCard.back} />
                    </div>
                  </>
                }
              />
            </motion.div>
          </AnimatePresence>

          {isLearningState && (
            <div className="text-center text-sm text-muted-foreground">
              {t('step_indicator', { step: (cardState.step ?? 0) + 1 })}
            </div>
          )}

          <div
            className={`grid grid-cols-2 gap-2 transition-opacity duration-150 ${
              flipped ? '' : 'pointer-events-none opacity-30'
            }`}
          >
            <Button onClick={() => handleAnswer(false, 1)} aria-keyshortcuts="1">
              <X className="mr-1.5 h-4 w-4 text-red-500" />{' '}
              {isLearningState ? t('rating_again_learning') : t('rating_again')}
            </Button>
            <Button onClick={() => handleAnswer(false, 2)} aria-keyshortcuts="2">
              <Minus className="mr-1.5 h-4 w-4 text-orange-500" />{' '}
              {isLearningState ? t('rating_hard_learning') : t('rating_hard')}
            </Button>
            <Button onClick={() => handleAnswer(true, 3)} aria-keyshortcuts="3">
              <Check className="mr-1.5 h-4 w-4 text-amber-500" />{' '}
              {isLearningState ? t('rating_good_learning') : t('rating_good')}
            </Button>
            <Button onClick={() => handleAnswer(true, 4)} aria-keyshortcuts="4">
              <Zap className="mr-1.5 h-4 w-4 text-green-500" />{' '}
              {isLearningState ? t('rating_easy_learning') : t('rating_easy')}
            </Button>
          </div>
        </div>

        <KeyboardShortcutsPanel
          shortcuts={[
            { key: 'Space', label: t('rating_flip') },
            { key: '1', label: t('rating_again') },
            { key: '2', label: t('rating_hard') },
            { key: '3', label: t('rating_good') },
            { key: '4', label: t('rating_easy') },
          ]}
        />
      </div>
    </>
  );
}
