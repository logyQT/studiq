'use client';

import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';

type Locale = 'pl' | 'en';

function getLocale(): Locale {
  if (typeof document === 'undefined') return 'pl';
  const match = document.cookie.match(/NEXT_LOCALE=(pl|en)/);
  return (match?.[1] as Locale) || 'pl';
}

export function LanguageToggle() {
  const router = useRouter();
  const locale = getLocale();

  const changeLanguage = (lang: Locale) => {
    document.cookie = `NEXT_LOCALE=${lang}; path=/; max-age=31536000`;
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 relative hover:scale-[1.03] transition"
          title="Language"
        >
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-32">
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
