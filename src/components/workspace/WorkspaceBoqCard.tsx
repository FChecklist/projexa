"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import BoqDualViewGrid from "@/components/BoqDualViewGrid";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// BoqDualViewGrid takes a resolved boqId, not a projectId (it's normally
// reached via ScopeObjectClient, one specific BOQ's own Object Page) -- this
// resolves the project's current effective BOQ the same way
// BillingMilestonesClient already does (GET /api/reports/boq-analysis's own
// row.boqId), so the workspace card can embed the real grid without
// duplicating BOQ-selection logic. Cost-visibility redaction is untouched:
// BoqDualViewGrid renders exactly what the API returns, and that
// server-side redaction (R-50's hard floor) is identical whether the grid
// is reached from here or from /scope/[id] directly.
export function WorkspaceBoqCard({ projectId }: { projectId: string }) {
  const [boqId, setBoqId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ row?: { boqId: string | null } }>(`/api/reports/boq-analysis?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => {
        if (!cancelled) setBoqId(res.row?.boqId ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err, "Couldn't load this project's BOQ"));
          setBoqId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (boqId === undefined) {
    return <div className="grid h-24 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  }
  if (error) {
    return <p className="py-6 text-center text-sm text-px-error">{error}</p>;
  }
  if (!boqId) {
    return (
      <p className="py-6 text-center text-sm text-px-muted">
        No approved BOQ exists for this project yet.{" "}
        <Link href={`/scope/new?projectId=${encodeURIComponent(projectId)}`} className="text-px-teal underline">
          Create one
        </Link>
        .
      </p>
    );
  }
  return <BoqDualViewGrid boqId={boqId} />;
}
