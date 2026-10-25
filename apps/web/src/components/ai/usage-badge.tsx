'use client';

import { Badge } from '@studiq/ui';
import { Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { UsageInfo } from '@/hooks/use-ai-chat';

interface UsageBadgeProps {
  usage: UsageInfo | null;
}

export function UsageBadge({ usage }: UsageBadgeProps) {
  const t = useTranslations('AiChatPage');

  // "if configured" (STU-47): `-1` is unlimited and `0` means the plan defines
  // no limit, so neither has a counter to show.
  if (!usage || usage.limit <= 0) return null;

  const pct = Math.round((usage.current / usage.limit) * 100);
  const variant = pct >= 80 ? 'destructive' : pct >= 50 ? 'secondary' : 'outline';
  const label = t('usage_label', { current: usage.current, limit: usage.limit });

  return (
    <Badge
      variant={variant}
      className="gap-1.5 px-2.5 py-1 text-xs font-normal"
      title={label}
      aria-label={label}
    >
      <Zap className="h-3 w-3" />
      <span>
        {usage.current}/{usage.limit}
      </span>
    </Badge>
  );
}
