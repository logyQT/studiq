'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { type RefObject, useRef } from 'react';

interface SubmitConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Positions (from 0) of the questions with no answer. */
  unanswered: number[];
  onJump: (index: number) => void;
  /** Takes the focus after a jump: the button that opened the dialog is gone by then. */
  jumpTargetRef: RefObject<HTMLElement | null>;
  onConfirm: () => void;
}

/** The last step before a submission, which the student cannot undo (#1353). */
export function SubmitConfirmDialog({
  open,
  onOpenChange,
  unanswered,
  onJump,
  jumpTargetRef,
  onConfirm,
}: SubmitConfirmDialogProps) {
  const t = useTranslations('AppAssignmentTakePage');
  const jumped = useRef(false);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* One button per unanswered question: a long list must scroll, not push the actions
          off a short screen. */}
      <AlertDialogContent
        className="max-h-[85vh] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          if (!jumped.current) return;
          jumped.current = false;
          event.preventDefault();
          jumpTargetRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirm_title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {unanswered.length > 0 && `${t('confirm_unanswered', { count: unanswered.length })} `}
            {t('confirm_final')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {unanswered.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unanswered.map((index) => (
              <Button
                key={index}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  jumped.current = true;
                  onJump(index);
                  onOpenChange(false);
                }}
              >
                {t('confirm_jump', { number: index + 1 })}
              </Button>
            ))}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('confirm_back')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {unanswered.length > 0 ? t('confirm_submit_anyway') : t('confirm_submit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
