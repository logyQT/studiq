'use client';

import { useRef, useState, useCallback, useLayoutEffect } from 'react';

export function useScrollToBottom() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

   
  useLayoutEffect(() => {
    if (isAtBottomRef.current) {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  });

  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  return { containerRef, handleScroll, isAtBottom, scrollToBottom };
}
