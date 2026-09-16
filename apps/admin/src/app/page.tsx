import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { Shield } from 'lucide-react';

export default function AdminDashboard() {
  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Administration</h1>
        <p className="text-muted-foreground mt-2">Manage the StudiQ platform</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            <Shield className="w-8 h-8 text-primary" />
            <div>
              <CardTitle className="text-lg">Admin Panel</CardTitle>
              <CardDescription>Standalone administration app</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This admin panel runs independently on port 4000.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
