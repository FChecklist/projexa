"use client";

// R67 D-31 (R-090). Sumeet asked for "how many people are on site today, by
// trade, and what they cost". Both numbers already existed inside VERIDIAN's
// report catalogue -- which PROJEXA renders as a read-only "Not yet viewable
// here" card -- so the product had three different answers to "where is my
// attendance report" and none of them was a screen. This is the screen, and it
// sits where the work happens: between the Manpower tab bar and the attendance
// log.
//
// It is populated by pressing nothing: the date control defaults to today and
// the panel loads on mount.
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DataLoadError from "@/components/DataLoadError";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import {
  countCell, headlineSentence, moneyCell, presetRange, summaryToCsv, tradeLabel,
  RANGE_PRESET_LABELS, RECONCILIATION_BANNER, RECONCILIATION_EXPORT_REASON,
  type AttendanceSummary, type RangePreset,
} from "@/lib/attendance-summary";

const PRESETS: RangePreset[] = ["today", "week", "month"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendanceSummaryPanel({ projectId }: { projectId: string }) {
  const currencies = useCurrencies();
  // Attendance cost has no per-row currencyId -- roster daily rates are always
  // in the org's base currency, the same undefined-id lookup the roster table
  // already uses.
  const currency = currencyLabel(undefined, currencies);

  const [anchor, setAnchor] = useState(todayIso);
  const [preset, setPreset] = useState<RangePreset>("today");
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const range = presetRange(preset, anchor);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = presetRange(preset, anchor);
    try {
      const data = await fetchJson<AttendanceSummary>(
        `/api/attendance/summary?projectId=${encodeURIComponent(projectId)}&from=${from}&to=${to}`
      );
      setSummary(data);
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(errorMessage(err, "Couldn't load the attendance summary"));
    } finally {
      setLoading(false);
    }
  }, [projectId, preset, anchor]);

  useEffect(() => { void load(); }, [load]);

  const ties = summary?.reconciliation.ties !== false;
  const exportDisabledReason = !summary || summary.rows.length === 0
    ? "Nothing to export"
    : !ties
      ? RECONCILIATION_EXPORT_REASON
      : undefined;

  function exportCsv() {
    if (!summary) return;
    // Built from the rows on screen, client-side -- no XLSX library, and no
    // second server round trip that could answer with different numbers.
    const blob = new Blob([summaryToCsv(summary.rows, summary.totals)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function share() {
    setSharing(true);
    setShareError(null);
    try {
      const data = await fetchJson<{ url: string; expiresAt: string }>("/api/attendance/summary/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, from: range.from, to: range.to }),
      });
      setShareUrl(data.url);
    } catch (err) {
      setShareError(errorMessage(err, "Couldn't create a share link"));
    } finally {
      setSharing(false);
    }
  }

  return (
    <section className="rounded-md border border-px-border bg-white p-4" aria-label="Attendance summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Summary date"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value || todayIso())}
            className="h-8 w-40 text-[13px]"
          />
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              aria-pressed={preset === p}
              className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${
                preset === p ? "border-px-ink bg-px-ink text-white" : "border-px-border text-px-muted hover:bg-muted/50"
              }`}
            >
              {RANGE_PRESET_LABELS[p]}
            </button>
          ))}
          <span className="text-[11.5px] text-px-muted">{range.from} to {range.to}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!!exportDisabledReason} title={exportDisabledReason} onClick={exportCsv}>
            Export CSV{exportDisabledReason ? ` (${exportDisabledReason})` : ""}
          </Button>
          {/* Rendered by VERIDIAN and relayed byte-for-byte -- PROJEXA must not
              gain a PDF library. A disabled anchor is a button, so the reason
              can be shown the same way. */}
          {exportDisabledReason ? (
            <Button size="sm" variant="outline" disabled title={exportDisabledReason}>
              Export PDF ({exportDisabledReason})
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/attendance/summary/pdf?projectId=${encodeURIComponent(projectId)}&from=${range.from}&to=${range.to}`}>
                Export PDF
              </a>
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={sharing || !summary} onClick={() => void share()}>
            {sharing ? "Creating link…" : "Share"}
          </Button>
        </div>
      </div>

      {!ties && (
        <p role="alert" className="mt-3 rounded-md border border-px-error-border bg-px-error-light px-3 py-2 text-[12.5px] text-px-error">
          {RECONCILIATION_BANNER}
        </p>
      )}
      {shareUrl && (
        <p className="mt-3 rounded-md border border-px-border2 px-3 py-2 text-[12.5px] text-px-ink break-all">
          Share link created: {shareUrl}
        </p>
      )}
      {shareError && (
        <p role="alert" className="mt-3 text-[12.5px] text-px-error">{shareError}</p>
      )}

      {loading ? (
        <div className="grid h-24 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
      ) : loadError ? (
        <div className="mt-3"><DataLoadError messages={[loadError]} onRetry={load} /></div>
      ) : summary ? (
        <>
          <p className="mt-3 text-[14px] font-semibold text-px-ink">{headlineSentence(summary.headcount, summary.rows)}</p>
          {summary.rows.length === 0 ? (
            <p className="mt-2 text-[13px] text-px-muted">No attendance recorded for this project in this window.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trade</TableHead>
                    <TableHead className="text-right">Present</TableHead>
                    <TableHead className="text-right">Half day</TableHead>
                    <TableHead className="text-right">Absent</TableHead>
                    <TableHead className="text-right">Worker-days</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.rows.map((row) => (
                    <TableRow key={row.trade}>
                      <TableCell>{tradeLabel(row.trade)}</TableCell>
                      <TableCell className="text-right tabular-nums">{countCell(row.present)}</TableCell>
                      <TableCell className="text-right tabular-nums">{countCell(row.halfDay)}</TableCell>
                      <TableCell className="text-right tabular-nums">{countCell(row.absent)}</TableCell>
                      <TableCell className="text-right tabular-nums">{countCell(row.workerDays)}</TableCell>
                      <TableCell className="text-right tabular-nums">{moneyCell(row.cost, currency)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{countCell(summary.totals.present)}</TableCell>
                    <TableCell className="text-right tabular-nums">{countCell(summary.totals.halfDay)}</TableCell>
                    <TableCell className="text-right tabular-nums">{countCell(summary.totals.absent)}</TableCell>
                    <TableCell className="text-right tabular-nums">{countCell(summary.totals.workerDays)}</TableCell>
                    <TableCell className="text-right tabular-nums">{moneyCell(summary.totals.cost, currency)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
