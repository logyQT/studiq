'use client';

import { Button } from '@studiq/ui';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface CheckoutButtonProps {
  planId: string;
  /** Organization the plan is bought for; required for organization (manager) plans. */
  orgId?: string;
  children: React.ReactNode;
  variant?: 'default' | 'outline';
  className?: string;
}

export function CheckoutButton({
  planId,
  orgId,
  children,
  variant = 'default',
  className,
}: CheckoutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleClick() {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, orgId }),
      });

      if (!res.ok) throw new Error('Failed to create checkout session');

      const { data } = await res.json();
      window.location.href = data.url;
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button className={className} variant={variant} onClick={handleClick} disabled={isLoading}>
      {isLoading && <Loader2 className="size-4 mr-2 animate-spin" />}
      {children}
    </Button>
  );
}
