"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/PageHeading";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { fetchJson } from "@/lib/fetch-json";
import type { ProgressBar } from "@/lib/dashboard-overview";

// R46 P8 seq124 (M28 registry-model proof, function_id "dashboard.overview"
// -- see dashboard/overview/page.tsx's resolver comment for why this isn't
// "dashboard.dashboard", which seq125/PR #142 already claimed for the
// separate /dashboard/project screen): this screen has no real table columns
// to speak of (a title + one horizontal progress bar per project, not a
// table) -- so unlike the LIST conversions and boq.custom's CUSTOM
// conversion before it, what's registry-driven here is the two static UI
// text strings on the page (the heading and the empty-state message), keyed
// by `field` the same way boq.custom's columnLabel() reads its real column
// headers off a screen_definitions row. DEFAULT_LABELS mirrors the seeded
// row 1:1, so there is no visible difference between "resolved from the DB"
// and this fallback (M28: keep the hardcoded version behind a flag until
// verified). Nothing about data fetching, bar computation, or layout
// changed from before this seq -- see src/lib/dashboard-overview.ts.
export type RegistryColumn = ScreenColumn;

const DEFAULT_LABELS: ScreenColumn[] = [
  { field: "title", label: "Projects Overview", type: "text" },
  { field: "emptyState", label: "No active projects yet.", type: "text" },
];

function label(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

export default function ProjectsOverviewClient({
  bars,
  errorMessage,
  labels,
}: {
  bars: ProgressBar[];
  errorMessage: string | null;
  labels?: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const columns = labels && labels.length > 0 ? labels : DEFAULT_LABELS;

  // R67 D-03. A per-project read that failed leaves progressPercent null, and
  // this screen must say so rather than printing "0%" over an empty bar. The
  // Retry is PER ROW because the failure was per row: router.refresh() would
  // re-run the whole server component and re-issue every project's call to
  // recover one, and on a portfolio of forty that is forty requests to fix
  // one number. /api/dashboard/project/{id} is the same read the server made.
  const [recovered, setRecovered] = useState<Record<string, number>>({});
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const retryOne = useCallback(async (projectId: string) => {
    setRetrying((r) => ({ ...r, [projectId]: true }));
    try {
      const data = await fetchJson<{ progressPercent?: unknown }>(
        `/api/dashboard/project/${encodeURIComponent(projectId)}`
      );
      const value = data?.progressPercent;
      // Still no figure? Then the row keeps saying so. Writing a 0 here would
      // be the same fabrication one layer up.
      if (typeof value === "number" && Number.isFinite(value)) {
        setRecovered((prev) => ({ ...prev, [projectId]: value }));
      }
    } catch {
      // The row already reads "Couldn't load" and still offers Retry; there is
      // nothing further to say that it is not saying.
    } finally {
      setRetrying((r) => ({ ...r, [projectId]: false }));
    }
  }, []);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title={label(columns, "title", "Projects Overview")} />
      <Card className="shadow-card">
        <CardContent className="space-y-5 pt-6">
          {/*
            R52 / F_026 and R46S11_02. This block used to render the error line
            AND the empty state together, because `bars.length === 0` was tested
            without asking WHY the list was empty. On a VERIDIAN timeout
            fetchProjectProgressBars returns bars: [] with an errorMessage, so
            the page told a CEO "No active projects yet." for an org that has
            five -- proven in the same session by /dashboard, a different code
            path, listing all five. A false zero on the portfolio screen is
            worse than an error, because it reads as an answer.

            The two states are now mutually exclusive, and the failure branch
            carries the two affordances R46S11_02 recorded as missing: a way to
            retry, and a way to create a project. router.refresh() re-runs the
            server component that fetched this, which is the actual retry --
            not a client-side re-render of the same empty array.
          */}
          {errorMessage ? (
            <div role="alert" className="space-y-3 py-8 text-center">
              <p className="text-sm text-px-error">Could not load live data: {errorMessage}</p>
              <p className="text-sm text-px-muted">
                This is not the same as having no projects. Nothing is being shown because the request failed.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => router.refresh()}>Retry</Button>
                <Link href="/dashboard"><Button size="sm" variant="ghost">Go to Dashboard</Button></Link>
              </div>
            </div>
          ) : bars.length === 0 ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-px-muted">{label(columns, "emptyState", "No active projects yet.")}</p>
              {/* R46S11_02 recorded /dashboard offering a Create Project
                  button here and this screen offering nothing, so the control
                  stays. R67 D-01 / C-01: it is now the same real /projects/new
                  route the home screen points at -- one create screen, reached
                  the same way from both surfaces, instead of two copies of one
                  dialog that could drift apart. */}
              <div className="flex justify-center">
                <Button size="sm" asChild>
                  <Link href="/projects/new"><Plus className="size-4" /> Create Project</Link>
                </Button>
              </div>
            </div>
          ) : (
            // Real screen navigation (2026-08-30): cross-linking fix (module
            // #36) -- these rows never linked anywhere before. Each one now
            // opens the real per-project dashboard (/dashboard/project),
            // matching the SAP pattern of drilling from a portfolio report
            // into the object it summarizes.
            bars.map((p) => {
              const percent = recovered[p.id] ?? p.progressPercent;
              const unknown = percent === null || percent === undefined;
              return (
                <div key={p.id} className="space-y-1.5 rounded-md p-1.5 hover:bg-px-cloud/40">
                  <button
                    onClick={() => router.push(`/dashboard/project?projectId=${p.id}`)}
                    className="block w-full text-left"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{p.name}</span>
                      {unknown ? (
                        // An en-dash and the words, in the muted tone -- never
                        // "0%", which reads as a measurement nobody made.
                        <span className="text-px-muted">&ndash; Couldn&apos;t load</span>
                      ) : (
                        <span className="text-px-muted">{percent}%</span>
                      )}
                    </div>
                  </button>
                  {/* No bar at all for an unknown figure. A zero-length bar is
                      a drawn claim that the project has made no progress. */}
                  {unknown ? (
                    <button
                      type="button"
                      disabled={retrying[p.id]}
                      onClick={() => void retryOne(p.id)}
                      className="text-xs font-medium text-px-muted underline underline-offset-2 hover:no-underline disabled:no-underline"
                    >
                      {retrying[p.id] ? "Retrying…" : "Retry"}
                    </button>
                  ) : (
                    <Progress value={percent} />
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
