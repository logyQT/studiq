'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';

export default function DevClient() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Toast Test</h1>
      <p className="text-muted-foreground">Click buttons to test toast notifications.</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => toast.success('Success!')}>
          <CheckCircle className="mr-2 h-4 w-4" /> Success
        </Button>
        <Button onClick={() => toast.error('Error!')}>
          <XCircle className="mr-2 h-4 w-4" /> Error
        </Button>
        <Button variant="outline" onClick={() => toast.warning('Warning!')}>
          <AlertTriangle className="mr-2 h-4 w-4" /> Warning
        </Button>
        <Button variant="outline" onClick={() => toast.info('Info!')}>
          <Info className="mr-2 h-4 w-4" /> Info
        </Button>
      </div>
    </div>
  );
}
