'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

type Option = { label: string; value: string };

type MultiSelectProps = {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
};

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  emptyText,
  className,
}: MultiSelectProps) {
  const t = useTranslations('MultiSelectComponent');
  const [open, setOpen] = useState(false);

  const resolvedPlaceholder = placeholder ?? t('placeholder');
  const resolvedEmptyText = emptyText ?? t('no_results');

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const remove = (value: string) => {
    onChange(selected.filter((v) => v !== value));
  };

  const selectedLabels = options
    .filter((o) => selected.includes(o.value))
    .map((o) => o.label);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('h-auto min-h-10 w-full justify-between', className)}
        >
          <div className="flex flex-wrap gap-1">
            {selected.length === 0 && (
              <span className="text-muted-foreground">{resolvedPlaceholder}</span>
            )}
            {selectedLabels.slice(0, 3).map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="gap-1 whitespace-nowrap"
              >
                {label}
                <span
                  role="button"
                  tabIndex={0}
                  className="ml-0.5 rounded-full outline-hidden hover:bg-muted cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    const option = options.find((o) => o.label === label);
                    if (option) remove(option.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      const option = options.find((o) => o.label === label);
                      if (option) remove(option.value);
                    }
                  }}
                >
                  <X className="h-3 w-3" />
                </span>
              </Badge>
            ))}
            {selectedLabels.length > 3 && (
              <Badge variant="secondary" className="whitespace-nowrap">
                +{selectedLabels.length - 3}
              </Badge>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder={t('search')} />
          <CommandList>
            <CommandEmpty>{resolvedEmptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => toggle(option.value)}
                  >
                    <div
                      className={cn(
                        'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50',
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    {option.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
