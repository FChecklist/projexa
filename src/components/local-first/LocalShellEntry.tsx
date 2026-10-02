"use client";

// LOCAL-FIRST shell entry. The page that serves /local and /local/** is a STATIC document (force-static, no server data). Everything
// in the shell reads the laptop (identity, IndexedDB), so it is loaded in the browser only (ssr: false) and the prerendered HTML is
// just the skeleton below -- the same thing the first client render shows, whatever URL the service worker serves this document for.

import dynamic from "next/dynamic";

function ShellSkeleton() {
  return <div data-testid="local-shell-skeleton" aria-busy="true" className="min-h-screen bg-px-concrete" />;
}

const LocalShell = dynamic(() => import("@/lib/local-first/shell/LocalShell"), { ssr: false, loading: ShellSkeleton });

export default function LocalShellEntry() {
  return <LocalShell />;
}
