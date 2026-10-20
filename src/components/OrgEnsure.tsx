"use client";

// Silent organisation set-up for a signed-in person who has none (the e-mail-code sign-in creates the auth user only). Mounted once in the (app) layout,
// so every signed-in screen passes through it. It makes NO request of its own on a healthy session: it only reacts when the shell bootstrap
// (/api/shell, which every signed-in screen loads) answers "No organization". Then: provision with the default name, reload the shell, carry on.
// On failure: one plain sentence and a Try again button, logged through the client log. See src/lib/org/ensure-org-client.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserEnsureDeps } from "@/lib/org/browser-ensure";
import { reportClientError } from "@/lib/local-first/client-error-report";
import { loadShell, resetShellStore, useShell } from "@/lib/shell-store";
import { ensureOrganization, ENSURE_FAILED_MESSAGE, NO_ORGANIZATION_PATTERN } from "@/lib/org/ensure-org-client";

export function OrgEnsure() {
  const router = useRouter();
  const shell = useShell({ enabled: false });
  const [failed, setFailed] = useState(false);
  const running = useRef(false);
  const autoTried = useRef(false); // the automatic run happens once per mount: a still-failing shell must not loop

  const noOrganization = Boolean(shell.errors.shell && NO_ORGANIZATION_PATTERN.test(shell.errors.shell));

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setFailed(false);
    try {
      const r = await ensureOrganization(browserEnsureDeps());
      if (r.status === "failed") {
        reportClientError("org-provision", new Error(r.error), "OrgEnsure");
        setFailed(true);
        return;
      }
      if (r.status === "provisioned") {
        resetShellStore(); // the shell was loaded before an organisation existed
        await loadShell(true);
        router.refresh();
      }
    } finally {
      running.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (noOrganization && !autoTried.current) {
      autoTried.current = true;
      void run();
    }
  }, [noOrganization, run]);

  if (!failed) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b border-px-error-border bg-px-error-light px-4 py-2 text-sm text-px-error">
      <span>{ENSURE_FAILED_MESSAGE}</span>
      <button type="button" className="rounded border border-px-error-border px-2 py-0.5 font-medium" onClick={() => void run()}>
        Try again
      </button>
    </div>
  );
}
