'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-9 w-9" />;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <Button variant="outline" size="icon" onClick={() => setTheme(isDark ? 'light' : 'dark')}>
      <Sun
        className={`h-[1.2rem] w-[1.2rem] transition-all ${isDark ? 'scale-0 rotate-90' : 'scale-100 rotate-0'}`}
      />

      <Moon
        className={`absolute h-[1.2rem] w-[1.2rem] transition-all ${isDark ? 'scale-100 rotate-0' : 'scale-0 -rotate-90'}`}
      />

      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
