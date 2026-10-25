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

  if (!usage) return null;

  // `-1` is the resolver's "unlimited"; `0` means the plan grants no AI budget
  // at all, which must read as blocked rather than as an empty progress bar.
  const unlimited = usage.limit === -1;
  const exhausted = usage.limit === 0;
  const pct = usage.limit > 0 ? Math.round((usage.current / usage.limit) * 100) : 0;
  const variant = unlimited
    ? 'outline'
    : exhausted || pct >= 80
      ? 'destructive'
      : pct >= 50
        ? 'secondary'
        : 'outline';
  const label = unlimited
    ? t('usage_unlimited')
    : t('usage_label', { current: usage.current, limit: usage.limit });

  return (
    <Badge variant={variant} className="gap-1.5 px-2.5 py-1 text-xs font-normal" title={label}>
      <Zap className="h-3 w-3" />
      <span>{unlimited ? t('usage_unlimited') : `${usage.current}/${usage.limit}`}</span>
    </Badge>
  );
}
