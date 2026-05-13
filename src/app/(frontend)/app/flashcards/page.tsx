'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Play, FolderOpen, Tags } from 'lucide-react';

interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
}

interface Space {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
}

export default function FlashcardsPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);
  const [mode, setMode] = useState<'endless' | 'limited'>('endless');
  const [targetCount, setTargetCount] = useState(10);

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/flashcard-topics').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/v1/flashcard-spaces').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([t, s]) => {
        setTopics(t);
        setSpaces(s);
        setLoading(false);
      })
      .catch(() => {
        setTopics([]);
        setSpaces([]);
        setLoading(false);
      });
  }, []);

  function toggleTopic(id: string) {
    setSelectedTopics((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  function toggleSpace(id: string) {
    setSelectedSpaces((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function startSession() {
    if (selectedTopics.length === 0 && selectedSpaces.length === 0) return;

    const params = new URLSearchParams();
    if (selectedTopics.length > 0) params.set('topics', selectedTopics.join(','));
    if (selectedSpaces.length > 0) params.set('spaces', selectedSpaces.join(','));
    params.set('mode', mode);
    if (mode === 'limited') params.set('target', String(targetCount));

    router.push(`/app/flashcards/session?${params.toString()}`);
  }

  const totalCards =
    topics
      .filter((t) => selectedTopics.includes(t.id))
      .reduce((sum, t) => sum + t.flashcard_count, 0) +
    spaces
      .filter((s) => selectedSpaces.includes(s.id))
      .reduce((sum, s) => sum + s.flashcard_count, 0);

  if (loading) return <div className="flex justify-center py-12">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Flashcards</h2>
        <Link href="/app/flashcards/spaces">
          <Button variant="outline">
            <FolderOpen className="mr-2 h-4 w-4" /> Manage Spaces
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5" /> Topics
            </CardTitle>
            <CardDescription>Select one or more topics to practice</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {topics.map((topic) => (
                <div key={topic.id} className="flex items-center gap-3 p-3 rounded-lg border">
                  <Checkbox
                    checked={selectedTopics.includes(topic.id)}
                    onCheckedChange={() => toggleTopic(topic.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{topic.name}</p>
                    <p className="text-xs text-muted-foreground">{topic.flashcard_count} cards</p>
                  </div>
                </div>
              ))}
              {topics.length === 0 && (
                <p className="text-center py-4 text-muted-foreground text-sm">
                  No topics available yet
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" /> Your Spaces
            </CardTitle>
            <CardDescription>Select one or more spaces to practice</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {spaces.map((space) => (
                <div key={space.id} className="flex items-center gap-3 p-3 rounded-lg border">
                  <Checkbox
                    checked={selectedSpaces.includes(space.id)}
                    onCheckedChange={() => toggleSpace(space.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{space.name}</p>
                    <p className="text-xs text-muted-foreground">{space.flashcard_count} cards</p>
                  </div>
                </div>
              ))}
              {spaces.length === 0 && (
                <p className="text-center py-4 text-muted-foreground text-sm">
                  No spaces yet. Create one!
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Practice Mode</CardTitle>
          <CardDescription>Choose how you want to practice</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <button
              className={`flex-1 p-4 rounded-lg border-2 text-left transition-colors ${
                mode === 'endless' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
              onClick={() => setMode('endless')}
            >
              <p className="font-medium">Endless</p>
              <p className="text-sm text-muted-foreground">Keep practicing until you stop</p>
            </button>
            <button
              className={`flex-1 p-4 rounded-lg border-2 text-left transition-colors ${
                mode === 'limited' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
              onClick={() => setMode('limited')}
            >
              <p className="font-medium">Limited</p>
              <p className="text-sm text-muted-foreground">Practice a set number of cards</p>
            </button>
          </div>

          {mode === 'limited' && (
            <div>
              <Label>Number of cards to practice: {targetCount}</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={targetCount}
                onChange={(e) =>
                  setTargetCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))
                }
                className="mt-2 max-w-32"
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-muted-foreground">
              {selectedTopics.length + selectedSpaces.length === 0
                ? 'Select topics or spaces to start'
                : `${totalCards} cards available`}
            </p>
            <Button
              onClick={startSession}
              disabled={selectedTopics.length === 0 && selectedSpaces.length === 0}
            >
              <Play className="mr-2 h-4 w-4" /> Start Practice
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
