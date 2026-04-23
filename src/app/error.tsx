"use client";

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Uncaught Runtime Error:", error);
  }, [error]);

  return (
    // Uses theme background and foreground
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center bg-background text-foreground">
      {/* Uses Card and Border tokens */}
      <div className="bg-card p-8 rounded-lg shadow-sm border border-border max-w-md">
        {/* Uses Destructive token for the heading to signal an error */}
        <h2 className="text-2xl font-bold text-destructive mb-2">Oops! Something went wrong</h2>

        {/* Uses Muted Foreground for secondary text */}
        <p className="text-muted-foreground mb-6">An unexpected error occurred. This has been logged and we're looking into it.</p>

        <div className="flex gap-4 justify-center">
          {/* Primary Button: Uses Primary and Primary-Foreground */}
          <button onClick={() => reset()} className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity font-medium">
            Try again
          </button>

          {/* Secondary Button: Uses Secondary tokens */}
          <button onClick={() => (window.location.href = "/")} className="px-6 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-accent hover:text-accent-foreground transition-colors font-medium border border-border">
            Go Home
          </button>
        </div>

        {/* Development Error Details */}
        {process.env.NODE_ENV === "development" && (
          <div className="mt-8 text-left">
            <p className="text-xs font-mono text-destructive p-4 bg-muted rounded-sm overflow-auto max-w-full border border-border">{error.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
