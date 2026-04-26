import { createClient } from "@/lib/supabase/server";

export default async function ServerSessionTest() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  return (
    <div className="p-8 bg-background text-foreground min-h-screen">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-primary">Server Session Test</h1>
        
        <div className="p-4 border border-border rounded-lg bg-card">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Status Połączenia</h2>
          {error ? (
            <p className="text-destructive font-semibold text-lg">Błąd: {error.message}</p>
          ) : user ? (
            <p className="text-primary font-semibold text-lg">✅ Sesja aktywna na serwerze</p>
          ) : (
            <p className="text-muted-foreground font-semibold text-lg">ℹ️ Brak sesji (Niezalogowany)</p>
          )}
        </div>

        {user && (
          <div className="space-y-4">
            <div className="p-4 rounded-md bg-muted border border-border">
              <p className="text-sm text-muted-foreground mb-1">Zalogowany jako:</p>
              <p className="font-mono text-foreground">{user.email}</p>
            </div>
            
            <div className="p-4 rounded-md bg-accent/10 border border-accent">
              <h3 className="text-sm font-bold text-accent-foreground mb-2">Raw User Data:</h3>
              <pre className="text-xs overflow-auto max-h-60 text-foreground/80">
                {JSON.stringify(user, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}