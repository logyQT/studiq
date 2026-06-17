'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';

interface AiChatGreetingProps {
  userName?: string;
  onSuggestion: (text: string) => void;
}

export function AiChatGreeting({ userName, onSuggestion }: AiChatGreetingProps) {
  const t = useTranslations('AiChatPage');

  const suggestions = [
    t('suggestion_1'),
    t('suggestion_2'),
    t('suggestion_3'),
    t('suggestion_4'),
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="mb-8 text-center"
    >
      <h1 className="mb-2 text-4xl font-medium tracking-tight sm:text-5xl md:text-6xl">
        <span className="bg-gradient-to-r from-blue-500 via-purple-500 to-red-500 bg-clip-text text-transparent">
          {t('greeting')}
          {userName ? `, ${userName}` : ''}
        </span>
      </h1>
      <p className="mb-8 text-lg text-muted-foreground">{t('greeting_suffix')}</p>

      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSuggestion(suggestion)}
            className="rounded-full border border-border/60 bg-muted/30 px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
