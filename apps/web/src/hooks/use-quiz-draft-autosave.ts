'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { apiPut } from '@/lib/api';
import { type DraftQuestion, toSaveAnswersPayload } from '@/lib/quiz-draft';
import { createDraftSaver } from '@/lib/quiz-draft-saver';

const AUTOSAVE_DELAY_MS = 500;

const draftBody = (questions: DraftQuestion[], answers: Record<string, string | undefined>) =>
  JSON.stringify({ answers: toSaveAnswersPayload(questions, answers) });

/**
 * Saves the answers of a running attempt while the student works, and once more when the page
 * goes away. Call `markSaved` with the answers restored from the server before the first save.
 */
export function useQuizDraftAutosave({
  attemptId,
  questions,
  answers,
  failureMessage,
}: {
  attemptId: string;
  questions: DraftQuestion[] | undefined;
  answers: Record<string, string | undefined>;
  failureMessage: string;
}) {
  const message = useRef(failureMessage);
  message.current = failureMessage;
  // Stable on purpose: a new saver would not know the restored state and would save nothing, so
  // a language change must not make one.
  const reportFailure = useCallback(() => {
    toast.error(message.current);
  }, []);

  const saver = useMemo(() => {
    const url = `/api/v1/quiz/${attemptId}/answers`;
    return createDraftSaver({
      delayMs: AUTOSAVE_DELAY_MS,
      put: async (body) => {
        const parsed: unknown = JSON.parse(body);
        await apiPut(url, parsed);
      },
      // `keepalive` lets the request finish after the page is gone.
      flush: (body) => {
        fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      },
      onFailure: reportFailure,
    });
  }, [attemptId, reportFailure]);

  useEffect(() => {
    if (questions) saver.change(draftBody(questions, answers));
  }, [saver, questions, answers]);

  // Leaving inside the app unmounts the page; a reload or a closed tab only fires `pagehide`.
  useEffect(() => {
    const leave = () => saver.leave();
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [saver]);

  const markSaved = useCallback(
    (restoredQuestions: DraftQuestion[], restored: Record<string, string | undefined>) =>
      saver.markSaved(draftBody(restoredQuestions, restored)),
    [saver],
  );

  return useMemo(
    () => ({ markSaved, stop: () => saver.stop(), resume: () => saver.resume() }),
    [markSaved, saver],
  );
}
