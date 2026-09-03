"use client";

// R67 (audit R-086): every list in this product answered "loading" with a
// single centred Loader2 spinner in a 128 px box, then swapped it for a table
// of an unrelated height -- so the card jumped and whatever the user was
// aiming at moved, which is the same layout-reflow defect
// src/components/DataLoadError.tsx's own header is careful about.
//
// A skeleton built from the SAME columns array the real table uses holds the
// card's height and shows the shape of what is coming, and the caption names
// what is being loaded rather than leaving the user to guess.
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function SkeletonTable({
  headers,
  rows = 5,
  caption,
}: {
  /** The real column labels, so the header row is honest while the body loads. */
  headers: string[];
  rows?: number;
  /** e.g. "Loading roster for Cedar Heights Villa - Phase 1…" */
  caption?: string;
}) {
  return (
    <div>
      {caption ? (
        <p className="px-4 pt-3 text-[13px] text-px-muted" role="status">
          {caption}
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <TableRow key={rowIndex} aria-hidden>
              {headers.map((header) => (
                <TableCell key={header}>
                  <Skeleton className="h-4 w-full max-w-[10rem]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
