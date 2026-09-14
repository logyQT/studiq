'use client';

import { useCallback, useEffect, useState } from 'react';

export function useSelection<T extends string>() {
  const [selectedIds, setSelectedIds] = useState<Set<T>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  const toggleSelect = useCallback((id: T) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((ids: T[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelecting(false);
  }, []);

  const handleEnterSelectionMode = useCallback((id: T) => {
    setIsSelecting(true);
    setSelectedIds(new Set([id]));
  }, []);

  useEffect(() => {
    if (!isSelecting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSelecting, handleClearSelection]);

  return {
    selectedIds,
    setSelectedIds,
    isSelecting,
    setIsSelecting,
    toggleSelect,
    handleSelectAll,
    handleDeselectAll,
    handleClearSelection,
    handleEnterSelectionMode,
  };
}
