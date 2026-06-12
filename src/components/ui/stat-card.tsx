import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';

type StatCardVariant = 'blue' | 'violet' | 'emerald' | 'amber' | 'rose';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  trend?: {
    value: number;
    label: string;
  };
  progress?: number;
  variant?: StatCardVariant;
  className?: string;
}

const variantStyles: Record<
  StatCardVariant,
  { iconBg: string; iconColor: string; progressColor: string; glow: string }
> = {
  blue: {
    iconBg: 'bg-blue-500/10 dark:bg-blue-500/15',
    iconColor: 'text-blue-600 dark:text-blue-400',
    progressColor: 'bg-blue-500',
    glow: 'shadow-blue-500/5',
  },
  violet: {
    iconBg: 'bg-violet-500/10 dark:bg-violet-500/15',
    iconColor: 'text-violet-600 dark:text-violet-400',
    progressColor: 'bg-violet-500',
    glow: 'shadow-violet-500/5',
  },
  emerald: {
    iconBg: 'bg-emerald-500/10 dark:bg-emerald-500/15',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    progressColor: 'bg-emerald-500',
    glow: 'shadow-emerald-500/5',
  },
  amber: {
    iconBg: 'bg-amber-500/10 dark:bg-amber-500/15',
    iconColor: 'text-amber-600 dark:text-amber-400',
    progressColor: 'bg-amber-500',
    glow: 'shadow-amber-500/5',
  },
  rose: {
    iconBg: 'bg-rose-500/10 dark:bg-rose-500/15',
    iconColor: 'text-rose-600 dark:text-rose-400',
    progressColor: 'bg-rose-500',
    glow: 'shadow-rose-500/5',
  },
};

export function StatCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  progress,
  variant = 'blue',
  className,
}: StatCardProps) {
  const styles = variantStyles[variant];
  const isLoading = value === '...';

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-all duration-200 hover:shadow-md',
        styles.glow,
        className,
      )}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
              {title}
            </p>
            {isLoading ? (
              <div className="h-9 w-20 rounded-lg bg-muted animate-pulse" />
            ) : (
              <p className="text-3xl font-bold tracking-tight tabular-nums">{value}</p>
            )}
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
            {trend && (
              <p
                className={cn(
                  'text-xs font-medium',
                  trend.value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {trend.value >= 0 ? '+' : ''}
                {trend.value}% {trend.label}
              </p>
            )}
          </div>
          <div className={cn('rounded-xl p-3 shrink-0', styles.iconBg)}>
            <Icon className={cn('h-5 w-5', styles.iconColor)} />
          </div>
        </div>

        {typeof progress === 'number' && (
          <div className="mt-4 space-y-1">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-700', styles.progressColor)}
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
