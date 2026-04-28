'use client';

import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-9 w-9 relative transition-all hover:scale-[1.03]"
      onClick={() => {
        // ! HACK: Toggle theme by reading the DOM class instead of next-themes state to avoid hydration mismatch.
        const isDark = document.documentElement.classList.contains('dark');
        setTheme(isDark ? 'light' : 'dark');
      }}
      title="Toggle theme"
    >
      {/* SUN */}
      <Sun className="h-4 w-4 transition-all scale-100 rotate-0 opacity-100 dark:scale-0 dark:rotate-90 dark:opacity-0" />

      {/* MOON */}
      <Moon className="absolute h-4 w-4 transition-all scale-0 -rotate-90 opacity-0 dark:scale-100 dark:rotate-0 dark:opacity-100" />
    </Button>
  );
}
