"use client";

import { useEffect } from "react";
import { logRenderError } from "@/lib/client-log/install";

// Last resort: the whole app failed to draw (this replaces the root layout, so it brings its own <html>/<body>). The report is saved on the
// device first and sent when the connection allows.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logRenderError(error, "whole app");
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>PROJEXA could not open</h1>
        <p>Something went wrong. A full report has been saved so it can be fixed.</p>
        <button onClick={reset} style={{ padding: "8px 14px" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
