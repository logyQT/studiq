'use client';

import { useState, useRef, useCallback } from 'react';
import { Send, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FileUpload } from './file-upload';

interface ChatInputProps {
  onSend: (text: string, file?: File) => Promise<void>;
  isStreaming: boolean;
  onAbort: () => void;
}

export function ChatInput({ onSend, isStreaming, onAbort }: ChatInputProps) {
  const t = useTranslations('AiChatPage');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && !file) return;
    setText('');
    setFile(null);
    onSend(trimmed, file ?? undefined);
  }, [text, file, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t bg-background p-4">
      {file && (
        <div className="mb-2">
          <FileUpload file={file} onFileChange={setFile} />
        </div>
      )}
      <div className="flex items-end gap-2">
        {!isStreaming && (
          <FileUpload file={null} onFileChange={setFile} />
        )}
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('input_placeholder')}
          rows={1}
          className="min-h-[40px] max-h-[120px] resize-none"
        />
        {isStreaming ? (
          <Button onClick={onAbort} variant="destructive" size="icon" className="shrink-0" title={t('stop')}>
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleSend} disabled={!text.trim() && !file} size="icon" className="shrink-0" title={t('send')}>
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
