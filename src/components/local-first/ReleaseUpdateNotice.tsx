"use client";

// R-C15 (final audit 2026-10-22): a laptop keeps running the release it loaded this page with. The boot installs a newer one in the background (at most
// every six hours) and used to say nothing, so a returning user could sit on an old copy of a screen (the Reports buttons added in a later release did not
// appear) with no sign that anything newer existed. This says so, in words, with one button: Reload.
import { useEffect, useState } from "react";
import { RELEASE_UPDATED_EVENT } from "@/lib/local-first/release/shell-handoff";

export function ReleaseUpdateNotice({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const on = (e: Event) => setVersion(((e as CustomEvent).detail as { version?: string | null } | undefined)?.version ?? null);
    window.addEventListener(RELEASE_UPDATED_EVENT, on);
    return () => window.removeEventListener(RELEASE_UPDATED_EVENT, on);
  }, []);
  if (version === undefined) return null;
  return (
    <div role="status" data-testid="release-update-notice" className="flex flex-wrap items-center gap-3 border-b border-black/10 bg-px-cloud px-4 py-2 text-sm text-px-ink print:hidden">
      <span>A newer version of PROJEXA{version ? ` (${version})` : ""} was installed on this laptop. Reload to use it; nothing you entered is lost.</span>
      <button type="button" data-testid="release-update-reload" className="rounded-md bg-px-ink px-3 py-1 text-xs font-medium text-white" onClick={reload}>Reload</button>
    </div>
  );
}
