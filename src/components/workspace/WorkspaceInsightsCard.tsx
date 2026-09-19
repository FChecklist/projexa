"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowRight } from "lucide-react";
import Project360Client from "@/components/Project360Client";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type ExceptionCheck = { item: number; title: string; flagged: boolean; count: number };

// Insights: reuses Project360Client whole (the real Sumeet #7/#8 P&L +
// combined-analysis view, unchanged) plus a real summary tile over the
// 28-item Exceptions engine (GET /api/exceptions) -- the same real API
// ExceptionsClient itself reads, just reduced to a count here rather than
// the full expandable list, with a link out to the real page for that.
function ExceptionsSummaryTile({ projectId }: { projectId: string }) {
  const [checks, setChecks] = useState<ExceptionCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ checks?: ExceptionCheck[] }>(`/api/exceptions?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => {
        if (!cancelled) setChecks(res.checks ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Couldn't load the exceptions report"));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <Card className="shadow-card">
      <CardHeader><CardTitle className="font-heading text-base">Exceptions</CardTitle></CardHeader>
      <CardContent>
        {error && <p className="text-sm text-px-error">{error}</p>}
        {!error && checks === null && <div className="grid h-16 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>}
        {!error && checks !== null && (
          <>
            <p className="text-sm text-px-ink">
              {checks.filter((c) => c.flagged).length === 0
                ? `All ${checks.length} checks are clear.`
                : `${checks.filter((c) => c.flagged).length} of ${checks.length} checks are flagged.`}
            </p>
            <Link
              href={`/analysis/exceptions?projectId=${encodeURIComponent(projectId)}`}
              className="mt-2 inline-flex items-center gap-1 text-sm text-px-teal underline"
            >
              View the full 28-item report <ArrowRight className="size-3.5" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function WorkspaceInsightsCard({ projectId, projectName }: { projectId: string; projectName: string }) {
  return (
    <div className="space-y-4">
      <Project360Client projectId={projectId} projectName={projectName} />
      <ExceptionsSummaryTile projectId={projectId} />
    </div>
  );
}
