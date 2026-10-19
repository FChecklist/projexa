"use client";

// R-C14: the list and the single-instruction view for site instructions. Read-only screens over GET /api/site-instructions
// (list, one project) and GET /api/site-instructions/[id]. Creating one is the sibling screen, SiteInstructionCreateClient.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { takeScreenMessage, type ScreenMessage } from "@/lib/screen-message";
import { siLabel } from "@/lib/site-instruction-form";

export type SiteInstructionRow = {
  id: string;
  siNumber: number | null;
  issueDate: string | null;
  toContractor: string | null;
  description: string | null;
  drawingRef?: string | null;
  costImpact?: boolean | null;
  timeImpact?: boolean | null;
  boqId?: string | null;
};

const DASH = "–";
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : DASH);

export function SiteInstructionsList({ projectId, projectName }: { projectId: string; projectName?: string | null }) {
  const [rows, setRows] = useState<SiteInstructionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ siteInstructions?: SiteInstructionRow[] }>(`/api/site-instructions?projectId=${encodeURIComponent(projectId)}`)
      .then((body) => { if (!cancelled) setRows(body.siteInstructions ?? []); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err, "Could not load the site instructions")); });
    return () => { cancelled = true; };
  }, [projectId]);

  const newHref = `/site-instructions/new?projectId=${encodeURIComponent(projectId)}`;
  return (
    <div className="space-y-4" data-testid="si-list">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ct-navy">Site Instructions</h1>
          {projectName ? <p className="text-sm text-px-muted">{projectName}</p> : null}
        </div>
        <Link href={newHref} className="rounded-md bg-ct-navy px-3 py-2 text-sm text-white">+ New</Link>
      </div>
      {error ? <p role="alert" className="text-sm text-[color:var(--color-veri-status-late)]">{error}</p> : null}
      {!error && rows === null ? <p className="text-sm text-px-muted">Loading site instructions…</p> : null}
      {rows && rows.length === 0 ? <p className="text-sm text-px-muted">No site instructions in this project yet.</p> : null}
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow><TableHead>No.</TableHead><TableHead>Date</TableHead><TableHead>To</TableHead><TableHead>Instruction</TableHead><TableHead>Drawing</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((si) => (
                <TableRow key={si.id} data-testid="si-row">
                  <TableCell><Link className="underline" href={`/site-instructions/${si.id}?projectId=${encodeURIComponent(projectId)}`}>{siLabel(si.siNumber)}</Link></TableCell>
                  <TableCell>{day(si.issueDate)}</TableCell>
                  <TableCell>{si.toContractor ?? DASH}</TableCell>
                  <TableCell className="max-w-xs truncate">{si.description ?? DASH}</TableCell>
                  <TableCell>{si.drawingRef || DASH}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

export function SiteInstructionView({ id, projectId }: { id: string; projectId?: string | null }) {
  const [si, setSi] = useState<SiteInstructionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handed, setHanded] = useState<ScreenMessage | null>(null);

  useEffect(() => {
    // The receipt the create screen left for this one, shown once.
    setHanded(takeScreenMessage("site-instructions.object"));
    let cancelled = false;
    fetchJson<SiteInstructionRow | { siteInstruction?: SiteInstructionRow }>(`/api/site-instructions/${encodeURIComponent(id)}`)
      .then((body) => {
        if (cancelled) return;
        const row = (body as { siteInstruction?: SiteInstructionRow }).siteInstruction ?? (body as SiteInstructionRow);
        setSi(row);
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err, "Could not load this site instruction")); });
    return () => { cancelled = true; };
  }, [id]);

  const listHref = projectId ? `/site-instructions?projectId=${encodeURIComponent(projectId)}` : "/site-instructions";
  const facts: [string, string][] = si
    ? [
        ["Issue date", day(si.issueDate)],
        ["To contractor", si.toContractor ?? DASH],
        ["Drawing reference", si.drawingRef || DASH],
        ["Changes the cost", si.costImpact ? "Yes" : "No"],
      ]
    : [];
  return (
    <div className="space-y-4" data-testid="si-view">
      <p className="text-sm"><Link className="underline" href={listHref}>Back to Site Instructions</Link></p>
      <h1 className="text-xl font-semibold text-ct-navy">{si ? `Site Instruction ${siLabel(si.siNumber)}` : "Site Instruction"}</h1>
      {handed ? (
        <p role="status" className={`rounded-md border p-3 text-sm ${handed.level === "warning" ? "border-amber-400" : "border-emerald-400"}`}>{handed.text}</p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-[color:var(--color-veri-status-late)]">{error}</p> : null}
      {!error && !si ? <p className="text-sm text-px-muted">Loading…</p> : null}
      {si ? (
        <div className="max-w-xl space-y-3 rounded-lg border border-black/10 bg-white p-4 text-sm">
          <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
            {facts.map(([k, v]) => (<><dt key={`${k}-k`} className="text-px-muted">{k}</dt><dd key={`${k}-v`}>{v}</dd></>))}
          </dl>
          <div><p className="text-px-muted">Instruction</p><p className="whitespace-pre-wrap">{si.description ?? DASH}</p></div>
          {si.boqId ? <p><Link className="underline" href={`/scope/${si.boqId}`}>Open the linked BOQ</Link></p> : null}
        </div>
      ) : null}
    </div>
  );
}
