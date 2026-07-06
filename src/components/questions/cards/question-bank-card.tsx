'use client';

import { ArrowRight, Eye, MoreVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { useTranslations } from 'next-intl';
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getGradientHex } from '@/lib/color-utils';
import type { QuestionBank } from '@/types/questions';

interface QuestionBankCardProps {
  bank: QuestionBank;
  isSelecting: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  basePath: string;
  t: ReturnType<typeof useTranslations>;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSelect: () => void;
}

export const QuestionBankCard = memo(
  function QuestionBankCard({
    bank,
    isSelecting,
    isSelected,
    onToggleSelect,
    basePath,
    t,
    canUpdate,
    canDelete,
    onEdit,
    onDelete,
    onSelect,
  }: QuestionBankCardProps) {
    const router = useRouter();
    const gradientHex = getGradientHex(bank.id);

    return (
      <Card
        className={`group cursor-pointer flex flex-col h-full overflow-hidden transition-all duration-300 ease-out sm:hover:-translate-y-1 sm:hover:shadow-lg sm:hover:border-primary/40 ${
          isSelected ? 'ring-2 ring-primary border-transparent' : ''
        } max-sm:py-0 min-w-0 p-0`}
        onClick={() => {
          if (isSelecting) {
            onToggleSelect();
          } else {
            router.push(`${basePath}/${bank.id}`);
          }
        }}
      >
        {/* Mobile: Compact row */}
        <div className="relative flex items-center justify-between gap-3 p-3.5 sm:hidden max-w-[calc(100vw-2rem)]">
          {isSelecting && (
            <div className="absolute top-4 right-4 z-10">
              <Checkbox
                checked={isSelected}
                onCheckedChange={onToggleSelect}
                className="h-4 w-4 bg-background/90 border-muted-foreground/40 shadow-sm"
              />
            </div>
          )}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative shrink-0">
              <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/40 shadow-sm flex items-center justify-center">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id={`mob-grad-${bank.id}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={gradientHex.from} />
                      <stop offset="100%" stopColor={gradientHex.to} />
                    </linearGradient>
                  </defs>
                  <ellipse
                    cx="12"
                    cy="5"
                    rx="9"
                    ry="3"
                    stroke={`url(#mob-grad-${bank.id})`}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M3 5V19A9 3 0 0 0 21 19V5"
                    stroke={`url(#mob-grad-${bank.id})`}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M3 12A9 3 0 0 0 21 12"
                    stroke={`url(#mob-grad-${bank.id})`}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <h3 className="text-[15px] font-bold tracking-tight text-foreground truncate">
                {bank.name}
              </h3>
              <div className="flex items-center gap-1.5 text-muted-foreground/80">
                <Badge
                  variant="secondary"
                  className="bg-secondary/40 text-secondary-foreground hover:bg-secondary/40 border-transparent text-[11px] font-medium leading-none px-1.5 py-0.5 shadow-none"
                >
                  {t('n_questions', { count: bank.question_count })}
                </Badge>
              </div>
            </div>
          </div>

          {!isSelecting ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground/80 hover:text-foreground shrink-0 -mr-1"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUpdate && (
                  <DropdownMenuItem onSelect={onEdit}>{t('common_edit')}</DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => {
                    onSelect();
                    onToggleSelect();
                  }}
                >
                  {t('common_manage')}
                </DropdownMenuItem>
                {canDelete && (
                  <DropdownMenuItem onSelect={onDelete} className="text-destructive">
                    {t('common_delete')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="w-5 shrink-0" />
          )}
        </div>

        {/* Desktop: Card grid item */}
        <div className="hidden sm:flex flex-col flex-1 p-5 relative">
          {isSelecting && (
            <div className="absolute top-4 right-4 z-10">
              <Checkbox
                checked={isSelected}
                onCheckedChange={onToggleSelect}
                className="h-4 w-4 bg-background/80 shadow-sm"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="shrink-0">
                <div className="h-10 w-10 rounded-xl bg-muted/40 border border-border/50 shadow-sm flex items-center justify-center">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <defs>
                      <linearGradient id={`bank-grad-${bank.id}`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={gradientHex.from} />
                        <stop offset="100%" stopColor={gradientHex.to} />
                      </linearGradient>
                    </defs>
                    <ellipse
                      cx="12"
                      cy="5"
                      rx="9"
                      ry="3"
                      stroke={`url(#bank-grad-${bank.id})`}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 5V19A9 3 0 0 0 21 19V5"
                      stroke={`url(#bank-grad-${bank.id})`}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 12A9 3 0 0 0 21 12"
                      stroke={`url(#bank-grad-${bank.id})`}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
              <h3 className="text-lg font-bold tracking-tight text-foreground truncate min-w-0">
                {bank.name}
              </h3>
            </div>

            {!isSelecting && (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -mr-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canUpdate && (
                      <DropdownMenuItem onSelect={onEdit}>{t('common_edit')}</DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => {
                        onSelect();
                        onToggleSelect();
                      }}
                    >
                      {t('common_manage')}
                    </DropdownMenuItem>
                    {canDelete && (
                      <DropdownMenuItem onSelect={onDelete} className="text-destructive">
                        {t('common_delete')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <div className="mt-3 mb-4 flex-1">
            {bank.description && (
              <p className="text-sm text-muted-foreground/90 leading-relaxed line-clamp-2">
                {bank.description}
              </p>
            )}
          </div>

          <div className="mt-auto flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="bg-secondary/50 text-secondary-foreground hover:bg-secondary/70 border-transparent shadow-none font-medium px-2.5 py-0.5"
              >
                {t('n_questions', { count: bank.question_count })}
              </Badge>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-primary hover:text-primary hover:bg-primary/10 font-semibold px-2 -mr-2 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`${basePath}/${bank.id}`);
              }}
            >
              {canUpdate ? t('common_manage') : t('common_view')}
              {canUpdate ? <ArrowRight className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </Card>
    );
  },
  (prev, next) => {
    return (
      prev.bank.id === next.bank.id &&
      prev.bank.question_count === next.bank.question_count &&
      prev.bank.name === next.bank.name &&
      prev.bank.description === next.bank.description &&
      prev.isSelecting === next.isSelecting &&
      prev.isSelected === next.isSelected
    );
  },
);
