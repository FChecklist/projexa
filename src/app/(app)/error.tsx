"use client";

import { useEffect } from "react";
import { GuidedError } from "@/components/GuidedError";
import { currentScreen, projectIdFromSearch } from "@/lib/error-guide/context";
import { logRenderError } from "@/lib/client-log/install";

// A screen that broke while drawing. The shell (top rail, Task Master, composer) stays up around it, and the person gets the guided panel: what
// happened, what to do, "Try again" and a way out (src/lib/error-guide). The full report (what they were doing, which screen, which project, the
// technical detail) goes to the System log on their device first. Screens with their own error.tsx (the create forms, /reports) keep theirs; this
// one catches the rest.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logRenderError(error, "screen");
  }, [error]);

  const screen = currentScreen();
  return (
    <div className="flex-1 space-y-4 p-6">
      <GuidedError
        className="max-w-2xl"
        ctx={{ route: screen.route, search: screen.search, projectId: projectIdFromSearch(screen.search), code: "RENDER", serverMessage: error.message || undefined }}
        onRetry={reset}
      />
    </div>
  );
}
