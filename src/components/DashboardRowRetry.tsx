"use client";

// R67 E-21 (R-205). The row-level half of "never draw a bar for data you did
// not receive". /dashboard is a Server Component, so a row whose figures are
// missing from the payload cannot re-ask for them on its own -- this is the
// one client control that re-runs the server component (the same
// router.refresh() ProjectLoadError.tsx already uses for the whole-page case),
// scoped to a single row so one bad row never blanks the launchpad.

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export default function DashboardRowRetry({ label = "Retry" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(event) => {
        // The row is wrapped in a Link to the project dashboard; retrying a
        // failed read must not also navigate away from the screen the reader
        // is trying to fix.
        event.preventDefault();
        event.stopPropagation();
        startTransition(() => router.refresh());
      }}
      className="underline underline-offset-2 disabled:opacity-60"
    >
      {pending ? "Retrying…" : label}
    </button>
  );
}
