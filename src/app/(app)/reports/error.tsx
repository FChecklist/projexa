"use client";

import { useEffect } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

// R46 F_028 fix: /reports is the one project-scoped page that always renders
// its client tree (ReportsClient -> the "Full Catalog" tab's
// ReportCatalogSection) even when resolveSelectedProject() already failed --
// every sibling page (schedule, scope, work-progress, ...) instead renders
// `{project && <Client .../>}` and mounts NOTHING client-side on a VERIDIAN
// error, so this extra client-side activity (its own /api/reports/catalog +
// /api/companies fetches, on top of the sidebar's own /api/projects call --
// all hitting the same chronically slow VERIDIAN backend, see F_026/veridian-
// client.ts's R46 header comment) is unique to this route. F_028 (Supabase
// platform.r43_faults) observed that combination occasionally resolving into
// an unhandled client-render exception that escaped to Next.js's default
// full-page crash screen ("This page couldn't load") instead of degrading
// in place -- reproducible-enough in principle (a fetch settling after a
// component has moved on) but not pinned to one deterministic line even
// under a faithful, repeated live repro (a stub VERIDIAN backend that hangs
// exactly the way production does) -- see the PR this shipped in for that
// repro record. Per Next.js App Router convention, this file is a route-
// scoped error boundary: React itself already recovers gracefully from a
// throw inside any Client Component under this segment (ReportsClient and
// everything it renders) by rendering this UI instead of unmounting the
// whole app shell -- the crash symptom is fixed by this file existing at
// all, regardless of which exact line throws. Scoped to /reports only (not
// a blanket app-wide handler); see ReportCatalogSection.tsx for the
// accompanying res.ok hardening on the two fetches this route's default
// tab fires on every load.
export default function ReportsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[reports] client render error:", error);
  }, [error]);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Reports" />
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-px-error">
            Something went wrong loading Reports{error.message ? `: ${error.message}` : "."} This is usually a
            temporary VERIDIAN connectivity issue -- try again.
          </p>
          <Button size="sm" variant="outline" onClick={reset} className="gap-1.5 shrink-0">
            <RotateCcw className="size-3.5" /> Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
