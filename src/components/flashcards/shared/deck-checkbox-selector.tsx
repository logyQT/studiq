'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Deck } from '@/types/flashcards';

interface DeckCheckboxSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decks: Deck[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  title: string;
  description: string;
  buttonLabel: string;
  onConfirm: () => void;
  cancelLabel: string;
  emptyLabel: string;
}

export function DeckCheckboxSelector({
  open,
  onOpenChange,
  decks,
  selectedIds,
  onSelectionChange,
  title,
  description,
  buttonLabel,
  onConfirm,
  cancelLabel,
  emptyLabel,
}: DeckCheckboxSelectorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
          {decks.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <Checkbox
                checked={selectedIds.includes(d.id)}
                onCheckedChange={() =>
                  onSelectionChange(
                    selectedIds.includes(d.id)
                      ? selectedIds.filter((x) => x !== d.id)
                      : [...selectedIds, d.id],
                  )
                }
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{d.name}</p>
                {d.description && (
                  <p className="text-xs text-muted-foreground truncate">{d.description}</p>
                )}
              </div>
            </div>
          ))}
          {decks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">{emptyLabel}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={selectedIds.length === 0}>
            {buttonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
