"use client";

// Sumeet requirement (new, 2026-09-18): "PROJEXA-AI.COM SHOULD BE ABLE TO
// CAPTURE, ANALYZE, FIX, ALL OF THESE AS A SOFTWARE FOR EVERY PROJECT" --
// the 28-item deterministic exceptions report (see construction-exceptions-
// service.ts's own header for which items share a detector and why, and
// which needed new schema vs. were already answerable). Read-only by
// design: "fixing" a flagged row means acting on the real record it names
// (approve the stuck CO, file the missing diary, release the retention...)
// on THAT record's own screen -- change-orders, milestones, billing-
// milestones, scope -- not from this report.
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { toast } from "sonner";

type ExceptionRecord = { id: string; detail: string };
type ExceptionCheck = { item: number; title: string; flagged: boolean; count: number; records: ExceptionRecord[]; formula: string };

export default function ExceptionsClient({ projectId }: { projectId: string }) {
  const [checks, setChecks] = useState<ExceptionCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJson<{ checks?: ExceptionCheck[] }>(`/api/exceptions?projectId=${encodeURIComponent(projectId)}`)
      .then((d) => { if (!cancelled) setChecks(d.checks ?? []); })
      .catch((err) => {
        if (cancelled) return;
        const message = errorMessage(err, "Couldn't load the exceptions report");
        setError(message);
        toast.error(message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (error) return <p className="py-10 text-center text-sm text-px-error">{error}</p>;

  const flaggedCount = checks.filter((c) => c.flagged).length;
  const sorted = [...checks].sort((a, b) => a.item - b.item || a.title.localeCompare(b.title));

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardContent className="flex items-center gap-3 p-4">
          {flaggedCount === 0 ? (
            <>
              <CheckCircle2 className="size-5 text-px-success" />
              <p className="text-sm text-px-ink">No exceptions found -- all {checks.length} checks are clear.</p>
            </>
          ) : (
            <>
              <AlertTriangle className="size-5 text-px-error" />
              <p className="text-sm text-px-ink"><span className="font-medium">{flaggedCount}</span> of {checks.length} checks are flagged on this project.</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardContent className="p-0">
          <ul className="divide-y divide-px-border">
            {sorted.map((c) => {
              const key = `${c.item}-${c.title}`;
              const expanded = expandedKey === key;
              return (
                <li key={key} className="p-4">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 text-left"
                    onClick={() => setExpandedKey(expanded ? null : key)}
                    aria-expanded={expanded}
                  >
                    <div className="flex items-start gap-2">
                      {c.count > 0 ? <ChevronDown className={`mt-0.5 size-3.5 shrink-0 ${expanded ? "" : "-rotate-90"}`} /> : <span className="mt-0.5 size-3.5 shrink-0" />}
                      <div>
                        <p className="font-medium text-px-ink">#{c.item} — {c.title}</p>
                        <p className="text-xs text-px-muted">{c.formula}</p>
                      </div>
                    </div>
                    <Badge variant={c.flagged ? "destructive" : "outline"} className="shrink-0 text-[10px]">
                      {c.flagged ? `${c.count} flagged` : "Clear"}
                    </Badge>
                  </button>
                  {expanded && c.records.length > 0 && (
                    <ul className="mt-2 space-y-1 pl-6 text-xs text-px-muted">
                      {c.records.map((r) => <li key={r.id}>{r.detail}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
