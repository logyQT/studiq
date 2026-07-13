'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const DEV_USERS = [
  { label: 'Admin', email: 'admin@dev.local' },
  { label: 'M1', email: 'manager@dev.local' },
  { label: 'M2', email: 'manager2@dev.local' },
  { label: 'T1', email: 'teacher1@dev.local' },
  { label: 'T2', email: 'teacher2@dev.local' },
  { label: 'S1', email: 'student1@dev.local' },
  { label: 'S2', email: 'student2@dev.local' },
  { label: 'S3', email: 'student3@dev.local' },
] as const;

export function DevQuickLogin() {
  const router = useRouter();
  const { refresh } = useAuth();
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
        await refresh();
        router.refresh();
      }
    } finally {
      setLoadingEmail(null);
    }
  }

  return (
    <Card className="w-56 shadow-lg border-sidebar-border bg-sidebar">
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
