'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Deck } from '@/types/flashcards';

interface DeckRadioSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decks: Deck[];
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
  title: string;
  description: string;
  buttonLabel: string;
  onConfirm: () => void;
  cancelLabel: string;
  emptyLabel: string;
  countLabel?: (count: number) => string;
}

export function DeckRadioSelector({
  open,
  onOpenChange,
  decks,
  selectedId,
  onSelectionChange,
  title,
  description,
  buttonLabel,
  onConfirm,
  cancelLabel,
  emptyLabel,
  countLabel,
}: DeckRadioSelectorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
          {decks.map((d) => (
            <button
              key={d.id}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                selectedId === d.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'
              }`}
              onClick={() => onSelectionChange(d.id)}
            >
              <div
                className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                  selectedId === d.id ? 'border-primary' : 'border-muted-foreground'
                }`}
              >
                {selectedId === d.id && <div className="h-2 w-2 rounded-full bg-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{d.name}</p>
                {d.description && (
                  <p className="text-xs text-muted-foreground truncate">{d.description}</p>
                )}
              </div>
              {countLabel && <Badge variant="secondary">{countLabel(d.flashcard_count)}</Badge>}
            </button>
          ))}
          {decks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">{emptyLabel}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={!selectedId}>
            {buttonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
