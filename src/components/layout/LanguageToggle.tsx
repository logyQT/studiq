'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';

export function LanguageToggle() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [locale, setLocale] = useState<'pl' | 'en'>('pl');

  useEffect(() => {
    setMounted(true);
    const match = document.cookie.match(/NEXT_LOCALE=(pl|en)/);
    if (match) setLocale(match[1] as 'pl' | 'en');
  }, []);

  const changeLanguage = (newLocale: 'pl' | 'en') => {
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000`;
    setLocale(newLocale);
    router.refresh();
  };

  const label = locale === 'pl' ? '🇵🇱 PL' : '🇬🇧 EN';

  if (!mounted) {
    return <div className="h-9 w-[90px]" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="flex gap-2">
          {label}
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem
          onClick={() => changeLanguage('pl')}
          className={locale === 'pl' ? 'font-medium' : ''}
        >
          🇵🇱 Polski
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => changeLanguage('en')}
          className={locale === 'en' ? 'font-medium' : ''}
        >
          🇬🇧 English
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
