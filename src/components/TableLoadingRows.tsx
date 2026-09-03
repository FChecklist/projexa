"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

// R67 F-02/F-03/F-04 (R-035/R-057/R-060). What every one of these list screens
// showed while loading was a centred Loader2 spinner, or the word "Loading…".
// Both are the same failure: they tell the reader nothing about what is
// coming, and the layout jumps when the real table replaces them.
//
// This renders the REAL column headers -- the ones the registry resolved, or
// the screen's own fallback labels -- above grey rows of the right height, so
// the header row is on screen at first paint, the page does not reflow when
// data lands, and the reader can already see what they are waiting for.
//
// THE 150 ms DELAY IS THE POINT OF `delayMs`. A skeleton that flashes for
// 80 ms is worse than no skeleton: it reads as a glitch. Mounting after a
// short delay means a fast response (the warm, cached case this whole
// workstream is trying to produce) shows nothing at all, and only a genuinely
// slow one shows the skeleton. Pass delayMs={0} where the wait is known to be
// long -- e.g. a Suspense fallback for a server component that is fetching.
export function TableLoadingRows({
  headers,
  rows = 3,
  caption,
  delayMs = 150,
}: {
  headers: string[];
  rows?: number;
  caption?: string;
  delayMs?: number;
}) {
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return;
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  return (
    // aria-busy + a real status message: a screen reader is told the table is
    // loading, rather than being read an empty grid.
    <Card className="shadow-card" aria-busy="true">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }, (_, rowIndex) => (
              <TableRow key={rowIndex} data-testid="table-loading-row">
                {headers.map((label) => (
                  <TableCell key={label}>
                    <Skeleton className="h-4 w-full max-w-[10rem]" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {caption ? (
          <p role="status" className="border-t border-px-border px-4 py-2 text-[12.5px] text-px-muted">
            {caption}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default TableLoadingRows;
