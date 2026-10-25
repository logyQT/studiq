'use client';

import { useCallback, useRef, useState } from 'react';
import { apiUploadFile } from '@/lib/api';
import { formatMarkdown } from '@/lib/format-markdown';

function wrapSelection(
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  onChange: (v: string) => void,
  before: string,
  after: string,
  defaultText?: string,
) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = currentValue.substring(start, end) || defaultText || '';
  const replacement = before + selected + after;
  const newValue = currentValue.substring(0, start) + replacement + currentValue.substring(end);
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
  });
}

function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  onChange: (v: string) => void,
  text: string,
) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const newValue = currentValue.substring(0, start) + text + currentValue.substring(end);
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + text.length, start + text.length);
  });
}

export function useMarkdownEditor(
  front: string,
  back: string,
  onFrontChange: (value: string) => void,
  onBackChange: (value: string) => void,
) {
  const [preview, setPreview] = useState(false);
  const [activeSide, setActiveSide] = useState<'front' | 'back'>('front');
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Read the ref at call time: during render the refs are still null on the first
  // mount, so a value captured in render would stay null until something re-renders.
  const getActiveTextarea = useCallback(
    () => (activeSide === 'front' ? frontRef.current : backRef.current),
    [activeSide],
  );
  const activeValue = activeSide === 'front' ? front : back;
  const activeOnChange = activeSide === 'front' ? onFrontChange : onBackChange;

  const wrap = useCallback(
    (before: string, after: string, defaultText?: string) => {
      wrapSelection(getActiveTextarea(), activeValue, activeOnChange, before, after, defaultText);
    },
    [getActiveTextarea, activeValue, activeOnChange],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const result = await apiUploadFile<{ url: string }>(
          '/api/v1/flashcards/media/upload',
          file,
        );
        // Resolve the textarea only after the upload round-trip has completed.
        const textarea = getActiveTextarea();
        const isAudio = file.type.startsWith('audio/');
        if (isAudio) {
          insertAtCursor(
            textarea,
            activeValue,
            activeOnChange,
            `<audio controls src="${result.url}"></audio>`,
          );
        } else {
          const name = file.name.replace(/\.[^.]+$/, '');
          insertAtCursor(textarea, activeValue, activeOnChange, `![${name}](${result.url})`);
        }
      } finally {
        setUploading(false);
      }
    },
    [getActiveTextarea, activeValue, activeOnChange],
  );

  const handlePickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
      e.target.value = '';
    },
    [handleUpload],
  );

  const insertText = useCallback(
    (text: string) => {
      insertAtCursor(getActiveTextarea(), activeValue, activeOnChange, text);
    },
    [getActiveTextarea, activeValue, activeOnChange],
  );

  const formatBothSides = useCallback(() => {
    onFrontChange(formatMarkdown(front));
    onBackChange(formatMarkdown(back));
  }, [front, back, onFrontChange, onBackChange]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      dragCounter.current = 0;
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload],
  );

  return {
    preview,
    setPreview,
    activeSide,
    setActiveSide,
    uploading,
    isDragOver,
    wrap,
    insertText,
    formatBothSides,
    handlePickFile,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    frontRef,
    backRef,
    fileInputRef,
  };
}
