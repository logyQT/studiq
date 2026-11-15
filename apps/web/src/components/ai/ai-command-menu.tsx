'use client';

import type { SlashCommand } from '@studiq/server/lib/ai/commands';
import {
  Command,
  CommandItem,
  CommandList,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@studiq/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export const COMMAND_LIST_ID = 'ai-command-list';

export const commandOptionId = (command: SlashCommand) => `ai-command-${command.name}`;

interface AiCommandMenuProps {
  open: boolean;
  commands: readonly SlashCommand[];
  /** The highlighted command. The composer owns it: focus stays in the text field. */
  activeName: string | undefined;
  onActiveChange: (name: string) => void;
  onSelect: (command: SlashCommand) => void;
  onDismiss: () => void;
  /** The element the menu opens above (the composer). */
  children: ReactNode;
}

/**
 * The slash-command menu above the composer. It is a listbox the text field points to
 * (`aria-activedescendant`), not a place focus moves to: the user keeps typing while it is open,
 * and the composer drives the arrows, Tab, Enter and Escape.
 */
export function AiCommandMenu({
  open,
  commands,
  activeName,
  onActiveChange,
  onSelect,
  onDismiss,
  children,
}: AiCommandMenuProps) {
  const t = useTranslations('AiChatPage');

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-2rem))] p-1"
        // Focus stays in the text field, before the menu opens and after it closes.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Command
          shouldFilter={false}
          value={activeName}
          onValueChange={onActiveChange}
          label={t('command_menu_label')}
        >
          <CommandList id={COMMAND_LIST_ID}>
            {commands.map((command) => (
              <CommandItem
                key={command.name}
                id={commandOptionId(command)}
                value={command.name}
                // Keep the caret in the text field when the menu is clicked.
                onMouseDown={(event) => event.preventDefault()}
                onSelect={() => onSelect(command)}
                className="flex items-baseline gap-2"
              >
                <span className="font-mono text-sm">/{command.name}</span>
                <span className="text-xs text-muted-foreground">{t(command.argumentHintKey)}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {t(command.descriptionKey)}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
