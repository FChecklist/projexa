"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logRenderError } from "@/lib/client-log/install";

// A screen that broke while drawing. The shell (top rail, Task Master, composer) stays up around it, the person gets a plain sentence and a way
// forward, and the full report (what they were doing, which screen, which project, the technical detail) goes to the System log on their device first.
// Screens with their own error.tsx (the create forms, /reports) keep theirs; this one catches the rest.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logRenderError(error, "screen");
  }, [error]);

  return (
    <div className="flex-1 space-y-4 p-6">
      <div role="alert" className="max-w-2xl rounded-lg border border-px-error-border bg-px-error-light p-4 text-sm">
        <p className="font-medium text-px-error">This screen could not open</p>
        <p className="mt-1 text-px-error/90">Something went wrong while showing it. A full report has been saved, so it can be fixed. Nothing you entered elsewhere was lost.</p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={reset}>
            <RotateCcw className="mr-2 size-4" aria-hidden />
            Try again
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href="/dashboard">Go to the dashboard</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
