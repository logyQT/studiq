'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const DEV_USERS = [
  { label: 'Sys Admin', email: 'admin@dev.local' },
  { label: 'Univ Admin', email: 'uadmin@dev.local' },
  { label: 'Teacher', email: 'teacher@dev.local' },
  { label: 'Student', email: 'student@dev.local' },
  { label: 'Premium', email: 'premium@dev.local' },
] as const;

export function DevQuickLogin() {
  const router = useRouter();
  const [loadingEmail, setLoadingEmail] = useState<string | null>(null);

  if (process.env.NODE_ENV !== 'development') return null;

  async function quickLogin(email: string) {
    setLoadingEmail(email);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'pass' }),
      });
      const result = await res.json();
      if (result.success) {
        const supabase = createClient();
        await supabase.auth.setSession(result.data.session);
        router.refresh();
      }
    } finally {
      setLoadingEmail(null);
    }
  }

  return (
    <Card className="w-56 shadow-lg border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-muted-foreground font-normal">Dev Quick Login</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {DEV_USERS.map(({ label, email }) => (
          <Button
            key={email}
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs h-8"
            disabled={loadingEmail !== null}
            onClick={() => quickLogin(email)}
          >
            {loadingEmail === email && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
