'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Copy, Send, Upload, Plus } from 'lucide-react';
import { UNIVERSITY_ROLES, UniversityRole } from '@/types';

interface InvitationResult {
  success: boolean;
  data?: { inviteLink?: string };
  error?: string;
}

export default function InvitationsPage() {
  const [results, setResults] = useState<InvitationResult[]>([]);
  const [singleForm, setSingleForm] = useState<{ name: string; email: string; role: UniversityRole }>({ name: '', email: '', role: UNIVERSITY_ROLES[0] });
  const [bulkText, setBulkText] = useState('');
  const [bulkRole, setBulkRole] = useState<UniversityRole>(UNIVERSITY_ROLES[0]);
  const [loading, setLoading] = useState(false);

  async function handleSingleInvite() {
    if (!singleForm.name || !singleForm.email) {
      toast.error('Name and email are required');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/university/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(singleForm),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.inviteLink) {
        setResults([{ success: true, data: { inviteLink: data.inviteLink } }, ...results]);
        toast.success('Invitation created');
        setSingleForm({ name: '', email: '', role: UNIVERSITY_ROLES[0] });
      }
    } catch {
      toast.error('Failed to create invitation');
    }
    setLoading(false);
  }

  async function handleBulkInvite() {
    const lines = bulkText.split(/[\n,]+/).map((l) => l.trim()).filter((l) => l);
    if (lines.length === 0) {
      toast.error('No emails found');
      return;
    }
    setLoading(true);
    const invitations = lines.map((email) => ({
      name: email.split('@')[0],
      email,
      role: bulkRole,
    }));
    try {
      const res = await fetch('/api/v1/university/invitations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitations }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setResults([...data.results, ...results]);
      setBulkText('');
      toast.success(`${data.results.filter((r: InvitationResult) => r.success).length} invitations created`);
    } catch {
      toast.error('Failed to create bulk invitations');
    }
    setLoading(false);
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBulkText(text);
    toast.success('CSV loaded — review and submit');
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Invitations</h2>

      <Tabs defaultValue="single">
        <TabsList>
          <TabsTrigger value="single">Single Invite</TabsTrigger>
          <TabsTrigger value="bulk-text">Bulk (Text)</TabsTrigger>
          <TabsTrigger value="bulk-csv">Bulk (CSV)</TabsTrigger>
        </TabsList>

        <TabsContent value="single">
          <Card>
            <CardHeader>
              <CardTitle>Send Single Invitation</CardTitle>
              <CardDescription>Invite one person to your university</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Full Name</Label>
                <Input value={singleForm.name} onChange={(e) => setSingleForm({ ...singleForm, name: e.target.value })} placeholder="Jan Kowalski" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={singleForm.email} onChange={(e) => setSingleForm({ ...singleForm, email: e.target.value })} placeholder="jan@university.edu" />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={singleForm.role} onValueChange={(v) => setSingleForm({ ...singleForm, role: v as UniversityRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIVERSITY_ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSingleInvite} disabled={loading}>
                <Send className="mr-2 h-4 w-4" /> Send Invitation
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bulk-text">
          <Card>
            <CardHeader>
              <CardTitle>Bulk Invite via Text</CardTitle>
              <CardDescription>Paste emails (one per line or comma-separated)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Role for all invitees</Label>
                <Select value={bulkRole} onValueChange={(v) => setBulkRole(v as UniversityRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIVERSITY_ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Emails</Label>
                <Textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'student1@university.edu\nstudent2@university.edu\nstudent3@university.edu'}
                  rows={8}
                  className="font-mono text-sm"
                />
              </div>
              <Button onClick={handleBulkInvite} disabled={loading}>
                <Plus className="mr-2 h-4 w-4" /> Generate Invitations
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bulk-csv">
          <Card>
            <CardHeader>
              <CardTitle>Bulk Invite via CSV</CardTitle>
              <CardDescription>Upload a CSV file with columns: name, email, role (optional)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>CSV File</Label>
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">Drop your CSV here or click to browse</p>
                  <input type="file" accept=".csv" onChange={handleCsvUpload} className="mt-2" />
                </div>
              </div>
              {bulkText && (
                <>
                  <div>
                    <Label>Parsed Data</Label>
                    <Textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={8} className="font-mono text-sm" />
                  </div>
                  <Button onClick={handleBulkInvite} disabled={loading}>
                    <Send className="mr-2 h-4 w-4" /> Send Invitations
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Generated Invite Links</CardTitle>
            <CardDescription>Copy and share these links with invitees</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.filter((r) => r.success && r.data?.inviteLink).map((r, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg border">
                  <Badge variant="default" className="shrink-0">Success</Badge>
                  <Input readOnly value={r.data!.inviteLink} className="text-xs font-mono flex-1" />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(r.data!.inviteLink!);
                      toast.success('Copied!');
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {results.filter((r) => !r.success).map((r, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg border">
                  <Badge variant="destructive">Failed</Badge>
                  <span className="text-sm text-muted-foreground">{typeof r.error === 'string' ? r.error : 'Unknown error'}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
