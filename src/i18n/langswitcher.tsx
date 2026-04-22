"use client";

import { useRouter } from "next/navigation";

export function LanguageSwitcher() {
  const router = useRouter();

  const changeLanguage = (newLocale: "pl" | "en") => {
    // 1. Zapisujemy preferencję w ciasteczku (na 1 rok)
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000`;

    // 2. Odświeżamy widok, by pobrać nowe tłumaczenia z serwera
    router.refresh();
  };

  return (
    <div className="flex gap-4">
      <button onClick={() => changeLanguage("pl")}>🇵🇱 Polski</button>
      <button onClick={() => changeLanguage("en")}>🇬🇧 English</button>
    </div>
  );
}
