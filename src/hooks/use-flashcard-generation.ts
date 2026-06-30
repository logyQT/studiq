'use client';

import { useCallback, useRef, useState } from 'react';

export interface GeneratedFlashcard {
  question: string;
  answer: string;
  suggestedTopic: string;
}

export type GenerationStatus = 'idle' | 'generating' | 'complete' | 'error';

export interface UseGenerateReturn {
  flashcards: GeneratedFlashcard[];
  suggestedDeckName: string;
  progress: { processedChunks: number; totalChunks: number };
  status: GenerationStatus;
  errorMessage: string;
  generate: (file: File, language: string) => Promise<void>;
  reset: () => void;
}

/**
 * @deprecated Use useAiChat() with sendMessage() and context="flashcards" instead.
 * This hook is kept temporarily for the /app/flashcards/ai page.
 * Will be removed once that page redirects to the AI chat.
 */
export function useGenerateFlashcards(): UseGenerateReturn {
  console.warn('[DEPRECATED] useGenerateFlashcards is deprecated. Use useAiChat() instead.');
  const [flashcards, setFlashcards] = useState<GeneratedFlashcard[]>([]);
  const [suggestedDeckName, setSuggestedDeckName] = useState('');
  const [progress, setProgress] = useState({ processedChunks: 0, totalChunks: 0 });
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (file: File, language: string) => {
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    setStatus('generating');
    setFlashcards([]);
    setSuggestedDeckName('');
    setProgress({ processedChunks: 0, totalChunks: 0 });
    setErrorMessage('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('language', language);

    try {
      const res = await fetch('/api/v1/flashcards/generate/frompdf', {
        method: 'POST',
        body: formData,
        signal: abortController.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'UNKNOWN' }));
        setStatus('error');
        setErrorMessage(err.error || `HTTP ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setStatus('error');
        setErrorMessage('Response body is not readable');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6).trim();
          } else if (line === '' && currentEvent && currentData) {
            try {
              const parsed = JSON.parse(currentData);

              switch (currentEvent) {
                case 'flashcards': {
                  const cards = Array.isArray(parsed) ? parsed : [parsed];
                  setFlashcards((prev) => [...prev, ...cards]);
                  break;
                }
                case 'progress':
                  setProgress({
                    processedChunks: parsed.processedChunks ?? 0,
                    totalChunks: parsed.totalChunks ?? 0,
                  });
                  break;
                case 'complete':
                  setSuggestedDeckName(parsed.suggestedDeckName || '');
                  setStatus('complete');
                  break;
                case 'error':
                  setStatus('error');
                  setErrorMessage(parsed.message || 'Generation failed');
                  break;
              }
            } catch {
              // skip malformed events
            }

            currentEvent = '';
            currentData = '';
          }
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Network error');
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setFlashcards([]);
    setSuggestedDeckName('');
    setProgress({ processedChunks: 0, totalChunks: 0 });
    setStatus('idle');
    setErrorMessage('');
  }, []);

  return { flashcards, suggestedDeckName, progress, status, errorMessage, generate, reset };
}
