'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Copy, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ErrorLogEntry {
  id: string;
  error_code: string;
  message: string;
  stack_trace: string | null;
  url: string | null;
  method: string | null;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function ErrorLogsPage() {
  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('limit', '50');

      const res = await fetch(`/api/v1/admin/error-logs?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');

      const json = await res.json();
      if (json.success) {
        setLogs(json.data.data);
        setCount(json.data.count);
      }
    } catch {
      toast.error('Failed to fetch error logs');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timeout = setTimeout(fetchLogs, 300);
    return () => clearTimeout(timeout);
  }, [fetchLogs]);

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success('Error ID copied to clipboard');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Error Logs</h1>
        <p className="text-muted-foreground mt-2">
          Search and inspect unhandled exceptions by their UUID.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Recent Errors ({count})</span>
            <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </CardTitle>
          <CardDescription>
            Search by error UUID, message, or stack trace content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by UUID, message, or stack trace..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {loading ? 'Loading...' : 'No error logs found.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Error ID</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <>
                    <TableRow
                      key={log.id}
                      className="cursor-pointer"
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <TableCell>
                        {expandedId === log.id ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-xs">{log.id.slice(0, 8)}...</code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyId(log.id);
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive">{log.error_code}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate">{log.message}</TableCell>
                      <TableCell>
                        {log.method && log.url ? (
                          <code className="text-xs">
                            {log.method} {log.url}
                          </code>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(log.created_at)}
                      </TableCell>
                    </TableRow>
                    {expandedId === log.id && (
                      <TableRow key={`${log.id}-detail`}>
                        <TableCell colSpan={6} className="bg-muted/50">
                          <div className="space-y-4 p-4">
                            <div>
                              <p className="text-sm font-semibold mb-1">Full Error ID</p>
                              <div className="flex items-center gap-2">
                                <code className="text-xs bg-background px-2 py-1 rounded">
                                  {log.id}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6"
                                  onClick={() => copyId(log.id)}
                                >
                                  <Copy className="w-3 h-3 mr-1" />
                                  Copy
                                </Button>
                              </div>
                            </div>

                            {log.user_id && (
                              <div>
                                <p className="text-sm font-semibold mb-1">User ID</p>
                                <code className="text-xs bg-background px-2 py-1 rounded">
                                  {log.user_id}
                                </code>
                              </div>
                            )}

                            <div>
                              <p className="text-sm font-semibold mb-1">Message</p>
                              <p className="text-sm text-destructive">{log.message}</p>
                            </div>

                            {log.stack_trace && (
                              <div>
                                <p className="text-sm font-semibold mb-1">Stack Trace</p>
                                <pre className="text-xs bg-background p-3 rounded overflow-auto max-h-64 border border-border">
                                  {log.stack_trace}
                                </pre>
                              </div>
                            )}

                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                              <div>
                                <p className="text-sm font-semibold mb-1">Metadata</p>
                                <pre className="text-xs bg-background p-3 rounded overflow-auto max-h-48 border border-border">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
