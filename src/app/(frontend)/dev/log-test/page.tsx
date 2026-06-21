'use client';

import { useState } from 'react';

const LEVELS = ['info', 'warn', 'error', 'debug'] as const;
const NAMESPACES = ['ai', 'providers', 'pdf', 'cache', 'auth', 'trace', 'api', 'system'] as const;

type LogEntry = {
  level: string;
  namespace: string;
  message: string;
  metadata?: string;
  durationMs?: string;
  conversationId?: string;
};

export default function LogTestPage() {
  const [level, setLevel] = useState<string>('info');
  const [namespace, setNamespace] = useState<string>('ai');
  const [message, setMessage] = useState<string>('Test message');
  const [metadata, setMetadata] = useState<string>('');
  const [durationMs, setDurationMs] = useState<string>('');
  const [conversationId, setConversationId] = useState<string>('');
  const [results, setResults] = useState<Array<{ label: string; status: string }>>([]);
  const [running, setRunning] = useState(false);

  async function sendLog(entry: LogEntry) {
    const payload: Record<string, unknown> = { level: entry.level, namespace: entry.namespace, message: entry.message };
    if (entry.metadata) {
      try { payload.metadata = JSON.parse(entry.metadata); } catch { payload.metadata = entry.metadata; }
    }
    if (entry.durationMs) payload.durationMs = Number(entry.durationMs);
    if (entry.conversationId) payload.conversationId = entry.conversationId;

    const res = await fetch('/api/v1/dev/log-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  }

  async function handleManualSend() {
    setRunning(true);
    const label = `${level.toUpperCase()} [${namespace.toUpperCase()}] ${message}`;
    setResults((prev) => [{ label, status: 'sending...' }, ...prev]);
    const ok = await sendLog({ level, namespace, message, metadata, durationMs, conversationId });
    setResults((prev) => prev.map((r) => r.label === label ? { ...r, status: ok ? 'ok' : 'fail' } : r));
    setRunning(false);
  }

  async function handlePresetBattery() {
    setRunning(true);
    setResults([]);
    const total = LEVELS.length * NAMESPACES.length;
    let done = 0;

    for (const lvl of LEVELS) {
      for (const ns of NAMESPACES) {
        const label = `${lvl.toUpperCase()} [${ns.toUpperCase()}] Preset test — all optional fields populated`;
        setResults((prev) => [{ label, status: 'sending...' }, ...prev]);
        const ok = await sendLog({
          level: lvl,
          namespace: ns,
          message: `Preset test from ${ns} logger at ${lvl} level`,
          metadata: JSON.stringify({ test: true, source: 'preset-battery', timestamp: Date.now() }),
          durationMs: String(Math.floor(Math.random() * 5000)),
          conversationId: 'test-conv-' + ns,
        });
        setResults((prev) => prev.map((r) => r.label === label ? { ...r, status: ok ? 'ok' : 'fail' } : r));
        done++;
      }
    }

    setResults((prev) => [{ label: `✅ Battery complete: ${done}/${total} tests sent`, status: '' }, ...prev]);
    setRunning(false);
  }

  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Dev tools are disabled in production.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Logger Test Page</h1>

      <div className="rounded-lg border border-border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Manual Test</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Level</label>
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Namespace</label>
            <select value={namespace} onChange={(e) => setNamespace(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              {NAMESPACES.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Message</label>
          <input value={message} onChange={(e) => setMessage(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium">metadata (JSON)</label>
            <input value={metadata} onChange={(e) => setMetadata(e.target.value)} placeholder='{"key": "value"}' className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium">durationMs</label>
            <input value={durationMs} onChange={(e) => setDurationMs(e.target.value)} placeholder="150" type="number" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium">conversationId</label>
            <input value={conversationId} onChange={(e) => setConversationId(e.target.value)} placeholder="conv_123" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </div>
        </div>

        <button onClick={handleManualSend} disabled={running} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {running ? 'Sending...' : 'Send'}
        </button>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Preset Battery</h2>
        <p className="text-sm text-muted-foreground">Fires all {LEVELS.length} levels × {NAMESPACES.length} namespaces = {LEVELS.length * NAMESPACES.length} log calls with populated optional fields.</p>
        <button onClick={handlePresetBattery} disabled={running} className="rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50">
          {running ? 'Running...' : `Run All ${LEVELS.length * NAMESPACES.length} Combinations`}
        </button>
      </div>

      {results.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h2 className="text-lg font-semibold mb-2">Results</h2>
          <div className="max-h-80 overflow-y-auto space-y-1">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-sm font-mono">
                <span className={r.status === 'ok' ? 'text-emerald-500' : r.status === 'fail' ? 'text-red-500' : 'text-muted-foreground'}>
                  {r.status === 'ok' ? '✓' : r.status === 'fail' ? '✗' : '⋯'}
                </span>
                <span>{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
