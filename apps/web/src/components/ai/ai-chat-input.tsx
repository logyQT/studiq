'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@studiq/ui';
import { matchSlashCommands, type SlashCommand } from '@studiq/server/lib/ai/commands';
import { ArrowUp, FileText, Mic, Plus, Square, Upload, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import { AiCommandMenu, COMMAND_LIST_ID, commandOptionId } from '@/components/ai/ai-command-menu';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { cn } from '@/lib/utils';
import { SrLabel } from '@/components/shared/sr-label';

interface AiChatInputProps {
  onSend: (text: string, file?: File) => Promise<void>;
  isStreaming: boolean;
  onAbort: () => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
}

export function AiChatInput({
  onSend,
  isStreaming,
  onAbort,
  file,
  onFileChange,
}: AiChatInputProps) {
  const t = useTranslations('AiChatPage');
  const [text, setText] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { ref: textareaRef, resize, reset } = useAutoResize(200);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The command menu: the commands the text so far could be, the highlighted one, and the text the
  // user dismissed it for (Escape). Typing anything else brings it back.
  const [activeName, setActiveName] = useState<string | undefined>(undefined);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  // An input method (Japanese, Chinese, ...) uses Enter and the arrows to pick a candidate.
  const composing = useRef(false);

  const commands = matchSlashCommands(text);
  const menuOpen = commands.length > 0 && dismissedFor !== text;
  const active = commands.find((command) => command.name === activeName) ?? commands[0];

  const hasContent = text.trim().length > 0 || file !== null;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && !file) return;
    setText('');
    reset();
    void onSend(trimmed, file ?? undefined);
  }, [text, file, onSend, reset]);

  const selectCommand = (command: SlashCommand) => {
    setText(`/${command.name} `);
    setActiveName(undefined);
    resize();
    textareaRef.current?.focus();
  };

  const moveActive = (step: 1 | -1) => {
    if (!active) return;
    const next = (commands.indexOf(active) + step + commands.length) % commands.length;
    setActiveName(commands[next]?.name);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (composing.current || e.nativeEvent.isComposing) return;

    if (menuOpen && active) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveActive(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        selectCommand(active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedFor(text);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    resize();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f) onFileChange(f);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
        className="hidden"
        onChange={handleFileSelect}
      />

      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => onFileChange(null)}
            className="ml-auto shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <AiCommandMenu
        open={menuOpen}
        commands={commands}
        activeName={active?.name}
        onActiveChange={setActiveName}
        onSelect={selectCommand}
        onDismiss={() => setDismissedFor(text)}
      >
        <div
          className={cn(
            'grid gap-2 border bg-muted/50 px-4 py-3',
            'grid-cols-[auto_1fr_auto_auto]',
            hasContent ? 'grid-rows-[auto_auto] rounded-2xl' : 'grid-rows-1 rounded-full',
            'focus-within:bg-background focus-within:border-border focus-within:shadow-md',
          )}
        >
          <div className={cn('flex items-center', hasContent && 'row-start-2 col-start-1')}>
            <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <motion.div
                    animate={{ rotate: isMenuOpen ? 45 : 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    <Plus className="h-5 w-5" />
                  </motion.div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" sideOffset={8}>
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  {t('upload_file')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <Mic className="mr-2 h-4 w-4" />
                  {t('live_mode')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            aria-haspopup="listbox"
            aria-controls={COMMAND_LIST_ID}
            aria-autocomplete="list"
            aria-activedescendant={menuOpen && active ? commandOptionId(active) : undefined}
            placeholder={t('input_placeholder')}
            rows={1}
            className={cn(
              'max-h-[200px] min-h-[36px] resize-none bg-transparent py-1.5 leading-6 text-base outline-none placeholder:text-muted-foreground md:text-sm',
              // Added px-1.5 to align precisely with the p-1.5 on the Plus button below it
              hasContent ? 'col-span-4 row-start-1 px-1.5' : 'col-start-2',
            )}
          />

          <div className={cn('flex items-center', hasContent && 'row-start-2 col-start-3')}>
            <button
              type="button"
              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={t('live_mode')}
            >
              <Mic className="h-5 w-5" />
            </button>
          </div>

          {isStreaming ? (
            <div className={cn('flex items-center', hasContent && 'row-start-2 col-start-4')}>
              <Button
                onClick={onAbort}
                variant="destructive"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full"
              >
                <Square className="h-4 w-4" />
                <SrLabel k="stop_generating" />
              </Button>
            </div>
          ) : (
            hasContent && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className="row-start-2 col-start-4 flex items-center"
              >
                <Button onClick={handleSend} size="icon" className="h-9 w-9 shrink-0 rounded-full">
                  <ArrowUp className="h-4 w-4" />
                  <SrLabel k="send_message" />
                </Button>
              </motion.div>
            )
          )}
        </div>
      </AiCommandMenu>

      <p className="mt-2 text-center text-[10px] text-muted-foreground">{t('disclaimer')}</p>
    </div>
  );
}
