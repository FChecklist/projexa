"use client";

import { useEffect } from "react";
import { logRenderError } from "@/lib/client-log/install";

// Last resort: the whole app failed to draw (this replaces the root layout, so it brings its own <html>/<body>, and the app router is not
// available here -- so this is the guided panel written out in plain markup, with the same four parts: what happened, why, what to do, the buttons).
// The report is saved on the device first and sent when the connection allows.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logRenderError(error, "whole app");
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 640 }}>
        <div role="alert">
          <h1 style={{ fontSize: 20 }}>PROJEXA could not open</h1>
          <p>Something went wrong while starting the app. A full report has been saved on this device, so it can be fixed.</p>
          <p>Nothing you typed or saved has been lost.</p>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>What to do</p>
          <ol style={{ marginTop: 0 }}>
            <li>Press &quot;Try again&quot;.</li>
            <li>If it opens the same way, press &quot;Open the dashboard&quot;.</li>
            <li>If it still does not open, close this tab and open PROJEXA again.</li>
          </ol>
          <button onClick={reset} style={{ padding: "8px 14px", marginRight: 8 }}>
            Try again
          </button>
          <a href="/dashboard" style={{ padding: "8px 14px" }}>
            Open the dashboard
          </a>
        </div>
      </body>
    </html>
  );
}
