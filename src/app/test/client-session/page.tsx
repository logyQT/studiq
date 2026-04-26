"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ClientSessionTest() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const getInitialSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setLoading(false);
    };

    getInitialSession();

    // Nasłuchiwanie zmian sesji (np. po wygaśnięciu tokena lub wylogowaniu)
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="p-8 animate-pulse text-muted-foreground">Sprawdzanie sesji...</div>;

  return (
    <div className="p-8 bg-background text-foreground min-h-screen">
      <Card className="max-w-2xl mx-auto border-border bg-card">
        <CardHeader>
          <CardTitle className="text-primary">Client Session Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className={`p-4 rounded-md border ${session ? 'border-primary/50 bg-primary/5' : 'border-destructive/50 bg-destructive/5'}`}>
            <p className="text-sm font-medium">
              Status: {session ? 
                <span className="text-primary font-bold">ZALOGOWANY</span> : 
                <span className="text-destructive font-bold">WYLOGOWANY</span>
              }
            </p>
          </div>

          {session && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <p>ID Użytkownika: <span className="text-foreground font-mono">{session.user.id}</span></p>
                <p>Wygasa o: <span className="text-foreground font-medium">{new Date(session.expires_at * 1000).toLocaleString()}</span></p>
              </div>

              <div className="flex gap-4">
                <Button 
                  variant="outline" 
                  onClick={async () => {
                    const { data } = await supabase.auth.refreshSession();
                    console.log("Sesja odświeżona:", data);
                  }}
                >
                  Odśwież Token (Manual)
                </Button>
                
                <Button 
                  variant="destructive" 
                  onClick={async () => {
                    await fetch('/api/v1/auth/logout', { method: 'POST' });
                    window.location.reload();
                  }}
                >
                  Wyloguj przez API
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}