"use client";

// Silent organisation set-up for a signed-in person who has none (the e-mail-code sign-in creates the auth user only). Mounted once in the (app) layout,
// so every signed-in screen passes through it. Renders nothing when all is well; on failure shows one plain sentence and a Try again button, and logs
// the failure through the client log. See src/lib/org/ensure-org-client.ts.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserEnsureDeps } from "@/lib/org/browser-ensure";
import { reportClientError } from "@/lib/local-first/client-error-report";
import { resetShellStore } from "@/lib/shell-store";
import { ensureOrganization, ENSURE_FAILED_MESSAGE } from "@/lib/org/ensure-org-client";

const OK_KEY = "px-org-ok:";

export function OrgEnsure() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  const run = useCallback(async () => {
    setFailed(false);
    const deps = browserEnsureDeps();
    const user = await deps.getUser().catch(() => null);
    if (!user) return;
    try {
      if (window.sessionStorage.getItem(OK_KEY + user.id)) return; // already confirmed in this tab session: no extra query per page
    } catch { /* storage may be unavailable */ }
    const r = await ensureOrganization(deps);
    if (r.status === "failed") {
      reportClientError("org-provision", new Error(r.error), "OrgEnsure");
      setFailed(true);
      return;
    }
    if (r.status === "present" || r.status === "provisioned") {
      try { window.sessionStorage.setItem(OK_KEY + user.id, "1"); } catch { /* ignore */ }
    }
    if (r.status === "provisioned") {
      resetShellStore(); // the shell was loaded before an organisation existed
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    void run();
  }, [run]);

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
