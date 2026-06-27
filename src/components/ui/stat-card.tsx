import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { CardContent } from '@/components/ui/card';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type StatCardVariant = 'blue' | 'violet' | 'emerald' | 'amber' | 'rose';

interface StatCardProps {
  title: string;
  value: string | number | ReactNode;
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

interface VariantStyle {
  iconColor: string;
  progressColor: string;
  glow: string;
  accentBar: string;
  hoverBorder: string;
}

const variantStyles: Record<StatCardVariant, VariantStyle> = {
  blue: {
    iconColor: 'text-blue-600 dark:text-blue-400',
    progressColor: 'bg-blue-500',
    glow: 'shadow-blue-500/5',
    accentBar: 'bg-blue-500/40',
    hoverBorder: 'hover:border-blue-500/20',
  },
  violet: {
    iconColor: 'text-violet-600 dark:text-violet-400',
    progressColor: 'bg-violet-500',
    glow: 'shadow-violet-500/5',
    accentBar: 'bg-violet-500/40',
    hoverBorder: 'hover:border-violet-500/20',
  },
  emerald: {
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    progressColor: 'bg-emerald-500',
    glow: 'shadow-emerald-500/5',
    accentBar: 'bg-emerald-500/40',
    hoverBorder: 'hover:border-emerald-500/20',
  },
  amber: {
    iconColor: 'text-amber-600 dark:text-amber-400',
    progressColor: 'bg-amber-500',
    glow: 'shadow-amber-500/5',
    accentBar: 'bg-amber-500/40',
    hoverBorder: 'hover:border-amber-500/20',
  },
  rose: {
    iconColor: 'text-rose-600 dark:text-rose-400',
    progressColor: 'bg-rose-500',
    glow: 'shadow-rose-500/5',
    accentBar: 'bg-rose-500/40',
    hoverBorder: 'hover:border-rose-500/20',
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
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={cn(
        'bg-card text-card-foreground rounded-xl border py-6 shadow-sm relative overflow-hidden hover:shadow-lg transition-shadow duration-200',
        styles.glow,
        styles.hoverBorder,
        className,
      )}
    >
      <div className={cn('absolute top-0 left-0 right-0 h-[3.5px]', styles.accentBar)} />

      {/* Watermark icon */}
      <div className="absolute bottom-1 right-1 opacity-[0.06] dark:opacity-[0.08] pointer-events-none select-none">
        <Icon className={cn('h-32 w-32', styles.iconColor)} />
      </div>

      <CardContent className="p-6">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
            {title}
          </p>
          {isLoading ? (
            <div className="h-9 w-20 rounded-lg bg-muted animate-pulse" />
          ) : (
            <p className="text-3xl font-extrabold tracking-tight tabular-nums">{value}</p>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
          {trend && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium',
                trend.value >= 0
                  ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                  : 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
              )}
            >
              {trend.value >= 0 ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {Math.abs(trend.value)}% {trend.label}
            </span>
          )}
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
    </motion.div>
  );
}
