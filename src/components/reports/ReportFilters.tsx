"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

type ParamEntry = { key: string; value: string };

/**
 * report_definitions rows carry no formal per-row parameter schema --
 * FullCatalogEntry (getFullReportCatalog()) exposes name/description/
 * domain/status only, never executionConfig.requiredParams, and the row
 * itself only records requiredParams as an untyped string[] on
 * ExternalServiceConfig (see ai-os/PIVOT_CHART_TECH_DECISION_2026-07-27.md).
 * So these controls can't be generated from a declared schema; instead this
 * offers a real, generic re-triggering filter set: a date range (the
 * startDate/endDate names several definitions already read) plus free-form
 * key/value pairs for anything else (days, weekStart, projectId, ...).
 * Every change calls onChange with the full params object -- the caller
 * re-runs the report against the API, this never filters a static result
 * set client-side.
 */
export function ReportFilters({
  onChange,
  initialStartDate = "",
  initialEndDate = "",
}: {
  onChange: (params: Record<string, string>) => void;
  /**
   * R67 E-31 (R-264): the range the card ALREADY ran with, so the reader opening
   * the parameters sees the dates behind the numbers on screen rather than two
   * empty fields that imply nothing was filtered. The caller owns the default
   * (month to date) -- this component only has to show it.
   */
  initialStartDate?: string;
  initialEndDate?: string;
}) {
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [extra, setExtra] = useState<ParamEntry[]>([]);

  function buildParams(nextStart: string, nextEnd: string, nextExtra: ParamEntry[]): Record<string, string> {
    const params: Record<string, string> = {};
    if (nextStart) params.startDate = nextStart;
    if (nextEnd) params.endDate = nextEnd;
    for (const entry of nextExtra) {
      const key = entry.key.trim();
      if (key) params[key] = entry.value;
    }
    return params;
  }

  function updateStart(v: string) {
    setStartDate(v);
    onChange(buildParams(v, endDate, extra));
  }
  function updateEnd(v: string) {
    setEndDate(v);
    onChange(buildParams(startDate, v, extra));
  }
  function updateExtra(next: ParamEntry[]) {
    setExtra(next);
    onChange(buildParams(startDate, endDate, next));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs">From</Label>
        <Input type="date" value={startDate} onChange={(e) => updateStart(e.target.value)} className="h-8 w-36 text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">To</Label>
        <Input type="date" value={endDate} onChange={(e) => updateEnd(e.target.value)} className="h-8 w-36 text-xs" />
      </div>
      {extra.map((entry, i) => (
        <div key={i} className="flex items-end gap-1">
          <div className="space-y-1">
            <Label className="text-xs">Param name</Label>
            <Input
              value={entry.key}
              onChange={(e) => updateExtra(extra.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
              placeholder="e.g. companyId"
              className="h-8 w-32 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Value</Label>
            <Input
              value={entry.value}
              onChange={(e) => updateExtra(extra.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              className="h-8 w-32 text-xs"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => updateExtra(extra.filter((_, j) => j !== i))}
            aria-label="Remove parameter"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => updateExtra([...extra, { key: "", value: "" }])}>
        <Plus className="size-3.5" /> Add parameter
      </Button>
    </div>
  );
}
