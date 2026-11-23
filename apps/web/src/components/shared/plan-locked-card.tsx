'use client';

import { Button } from '@studiq/ui';
import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';

/**
 * Plan gate for a paid surface (ADR-0015 §7, phase 5d): rendered when the
 * account's effective entitlements lack the key. Mirrors `BrandingLockedCard`
 * (manage/settings) and `AiChatLockedState`: a dashed card with a `Lock` icon
 * and the pricing page as the only action — never an empty panel or a control
 * whose API would 403.
 *
 * Copy is passed in by the caller so each surface keeps its own i18n namespace.
 */
export function PlanLockedCard({
  title,
  description,
  cta,
  href = '/pricing',
}: {
  title: string;
  description: string;
  cta: string;
  href?: string;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => router.push(href)}>
        {cta}
      </Button>
    </div>
  );
}
