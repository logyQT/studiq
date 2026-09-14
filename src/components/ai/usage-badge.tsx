'use client';

import { Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { UsageInfo } from '@/hooks/use-ai-chat';

interface UsageBadgeProps {
  usage: UsageInfo | null;
}

export function UsageBadge({ usage }: UsageBadgeProps) {
  const t = useTranslations('AiChatPage');

  if (!usage) return null;

  const pct = usage.limit > 0 ? Math.round((usage.current / usage.limit) * 100) : 0;
  const variant = pct >= 80 ? 'destructive' : pct >= 50 ? 'secondary' : 'outline';

  return (
    <Badge
      variant={variant}
      className="gap-1.5 px-2.5 py-1 text-xs font-normal"
      title={t('usage_label', { current: usage.current, limit: usage.limit })}
    >
      <Zap className="h-3 w-3" />
      <span>
        {usage.current}/{usage.limit}
      </span>
    </Badge>
  );
}
