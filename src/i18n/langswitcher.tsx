"use client";

import { useRouter } from "next/navigation";

export function LanguageSwitcher() {
  const router = useRouter();

  const changeLanguage = (newLocale: "pl" | "en") => {
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000`;

    router.refresh();
  };

  return (
    <div className="flex gap-4">
      <button onClick={() => changeLanguage("pl")}>Polski</button>
      <button onClick={() => changeLanguage("en")}>English</button>
    </div>
  );
}
