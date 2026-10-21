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
import { ensureOrganization, NO_ORGANIZATION_PATTERN } from "@/lib/org/ensure-org-client";
import { GuidedPanel } from "@/components/GuidedPanel";
import { currentScreen } from "@/lib/error-guide/context";

export function OrgEnsure() {
  const router = useRouter();
  const shell = useShell({ enabled: false });
  const [failed, setFailed] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);
  const running = useRef(false);
  const autoTried = useRef(false); // the automatic run happens once per mount: a still-failing shell must not loop

  const noOrganization = Boolean(shell.errors.shell && NO_ORGANIZATION_PATTERN.test(shell.errors.shell));

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setFailed(null);
    setSetting(true);
    try {
      const r = await ensureOrganization(browserEnsureDeps());
      if (r.status === "failed") {
        reportClientError("org-provision", new Error(r.error), "OrgEnsure");
        setFailed(r.error);
        return;
      }
      if (r.status === "provisioned") {
        resetShellStore(); // the shell was loaded before an organisation existed
        await loadShell(true);
        router.refresh();
      }
    } finally {
      running.current = false;
      setSetting(false);
    }
  }, [router]);

  useEffect(() => {
    if (noOrganization && !autoTried.current) {
      autoTried.current = true;
      void run();
    }
  }, [noOrganization, run]);

  // GUIDED ERRORS (G4): while the set-up runs the person is told so (a calm note); if it fails they get the full panel with Try again. Nothing otherwise.
  if (!failed && !setting) return null;
  const screen = currentScreen();
  return (
    <div className="fixed inset-x-0 top-0 z-50 mx-auto max-w-xl p-3" data-testid="org-ensure">
      <GuidedPanel
        ctx={{ route: screen.route, search: screen.search, code: failed ? "ORG_SETUP_FAILED" : "ORG_SETUP_RUNNING", serverMessage: failed ?? undefined }}
        className="bg-white shadow-lg"
        fix={null}
        noCopy={!failed}
        actions={failed ? [{ id: "retry", label: "Try again", primary: true, onClick: () => void run() }] : []}
        progress={failed ? undefined : { label: "Creating your organisation..." }}
      />
    </div>
  );
}
