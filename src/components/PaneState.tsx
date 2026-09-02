"use client";

// R67 D-65 -- ONE data-pane state wrapper for the whole product.
//
// D-55, D-59 and D-65 each describe a state wrapper for the same situation:
// a screen has asked a backend for rows and is waiting. Three components
// would be the duplication this programme exists to remove, so this is the
// one, and D-59's "ScreenState" name is satisfied here rather than by a
// second file. The rules it enforces live in src/lib/pane-state.ts, where
// they are unit tests; this file is only their rendering.
//
// WHAT IT REPLACES, everywhere it is adopted:
//
//   {loading ? <Loader2 className="animate-spin"/> : rows.length === 0
//      ? <p>No permits yet for this project.</p> : <Table/>}
//
// with the fetch's failure handled by a toast that fades. Three defects in
// four lines: a wordless spinner that says nothing about what is coming and
// shifts the whole page when it resolves; an empty sentence reachable from a
// FAILED read, which tells a project with forty permits that it has none;
// and an error surface that disappears, leaving the lie on screen alone.
//
// The four (five) branches here are exhaustive and the empty one is
// reachable only through mayShowEmptyState(), which takes the outcome and
// not the row count -- so a screen cannot fall through to it by accident.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  asOfLabel,
  loadingCaption,
  mayShowEmptyState,
  paneError,
  type PaneStatus,
} from "@/lib/pane-state";

const DEFAULT_SKELETON_ROWS = 5;

/**
 * Ticks while a read is in flight so the elapsed-seconds caption actually
 * counts. 500 ms is fast enough that the number never looks stuck and slow
 * enough to be free. Nothing runs at all once the read has answered.
 */
function useElapsed(startedAt: number | null | undefined, active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active || !startedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - startedAt);
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [startedAt, active]);
  return elapsed;
}

export type PaneStateProps = {
  status: PaneStatus;
  /** The plural noun the user would use: "permits", "drawings", "your tasks". */
  entity: string;
  projectName?: string | null;
  /** Date.now() at the moment the current read was issued. */
  startedAt?: number | null;
  /** What the transport said, when it failed. */
  error?: { status?: number | null; message?: string | null } | null;
  /** How many rows are currently held -- NOT how many the server has. */
  rowCount: number;
  /** Header labels for the skeleton, so it is shaped like the real table. */
  skeletonColumns: string[];
  skeletonRows?: number;
  /** The sentence for a successful, genuinely empty read. */
  emptyMessage: string;
  /** The primary action offered beside the empty sentence. */
  emptyAction?: React.ReactNode;
  /** When the rows currently held were loaded, for "as of 14:32". */
  lastLoadedAt?: Date | null;
  onRetry?: () => void;
  /** The real table. Rendered whenever there are rows to show. */
  children: React.ReactNode;
};

export function PaneState({
  status,
  entity,
  projectName,
  startedAt,
  error,
  rowCount,
  skeletonColumns,
  skeletonRows = DEFAULT_SKELETON_ROWS,
  emptyMessage,
  emptyAction,
  lastLoadedAt,
  onRetry,
  children,
}: PaneStateProps) {
  const loading = status === "loading";
  const elapsed = useElapsed(startedAt, loading);
  const caption = loadingCaption(elapsed, entity, projectName);
  const described = status === "error" ? paneError(entity, error ?? {}) : null;
  const staleLabel = rowCount > 0 ? asOfLabel(lastLoadedAt ?? null) : null;

  return (
    <div className="space-y-3">
      {described && (
        <div role="alert" className="rounded-lg border border-px-error-border bg-px-error-light p-4 text-sm">
          <p className="flex items-start gap-2 font-medium text-px-error">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {described.sentence}
          </p>
          {/* The backend's own words survive underneath the closed-vocabulary
              sentence -- unless they leak the shape of the system, in which
              case the dictionary has already dropped them entirely. */}
          {described.detail && <p className="mt-1 pl-6 text-px-error/90">{described.detail}</p>}
          {described.retryable && onRetry && (
            <div className="mt-3 pl-6">
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw className="mr-2 size-4" aria-hidden />
                Retry
              </Button>
            </div>
          )}
        </div>
      )}

      {loading && (caption.primary || caption.secondary) && (
        <div role="status" className="px-1 text-[12px] text-px-muted">
          {caption.primary && <p>{caption.primary}</p>}
          {/* The elapsed line is added BELOW, never in place of, so nothing
              the user is already reading moves as the seconds tick. */}
          {caption.secondary && <p>{caption.secondary}</p>}
          {caption.showRetry && onRetry && (
            <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Retry
            </Button>
          )}
        </div>
      )}

      {loading && rowCount === 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {skeletonColumns.map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: skeletonRows }, (_, i) => (
              <TableRow key={`pane-skeleton-${i}`}>
                {skeletonColumns.map((label) => (
                  <TableCell key={label}>
                    <Skeleton className="h-4 w-full max-w-40" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Rows the user already had are NOT thrown away by a failed or
          in-flight refresh -- they are labelled with when they were true. */}
      {rowCount > 0 && (
        <div className="space-y-2">
          {staleLabel && status !== "ready" && (
            <p className="px-1 text-[12px] text-px-muted">Showing what loaded {staleLabel}.</p>
          )}
          {children}
        </div>
      )}

      {mayShowEmptyState(status, rowCount) && (
        <div className="space-y-3 py-10 text-center">
          <p className="text-sm text-px-muted">{emptyMessage}</p>
          {emptyAction}
        </div>
      )}

      {described && (
        <div
          role="status"
          className="rounded-lg border border-px-error-border bg-px-error-light px-3 py-2 text-[12px] text-px-error"
        >
          <span className="font-medium">{described.footer}</span> — {described.sentence}
        </div>
      )}
    </div>
  );
}

export default PaneState;
