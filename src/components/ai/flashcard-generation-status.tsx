'use client';

import { Brain, Check, CheckCircle2, Layers, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

const STEPS = [
  { key: 'status_thinking', Icon: Brain, animation: 'animate-pulse' },
  { key: 'status_generating', Icon: Sparkles, animation: 'animate-spin [--duration:3s]' },
  { key: 'status_organizing', Icon: Layers, animation: 'animate-bounce' },
  { key: 'status_almost_done', Icon: CheckCircle2, animation: 'animate-pulse' },
] as const;

interface FlashcardGenerationStatusProps {
  status: 'generating' | 'complete';
  count?: number;
}

export function FlashcardGenerationStatus({ status, count }: FlashcardGenerationStatusProps) {
  const t = useTranslations('AiChatPage');
  const [step, setStep] = useState(0);

  const nextStep = useCallback(() => {
    setStep((prev) => (prev + 1) % STEPS.length);
  }, []);

  useEffect(() => {
    if (status !== 'generating') return;
    const interval = setInterval(nextStep, 3000);
    return () => clearInterval(interval);
  }, [status, nextStep]);

  if (status === 'complete') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Check className="h-4 w-4 text-green-500" />
        <span>{t('flashcards_generated', { count: count ?? 0 })}</span>
      </div>
    );
  }

  const { Icon, animation } = STEPS[step];

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon className={`h-4 w-4 ${animation}`} />
      <span key={step}>{t(STEPS[step].key)}</span>
    </div>
  );
}
