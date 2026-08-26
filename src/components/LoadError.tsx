"use client";

// R52 Gate 2 (Output). The in-module twin of ProjectLoadError.
//
// ProjectLoadError covers the SERVER half: a page.tsx whose project resolution
// failed. This covers the CLIENT half -- a list/detail component whose own
// /api call failed. Both exist for the same reason and say the same kind of
// thing, because the user cannot see which half broke and should not have to.
//
// THE DEFECT THIS REPLACES, in the exact shape it was written 60-odd times:
//
//     const res  = await fetch("/api/vendors");
//     const data = await res.json();           // an ERROR body parses fine
//     setVendors(data.vendors ?? []);          // -> [] , and the screen says
//                                              //    "No vendors added yet."
//
// The user is told a FACT ("you have zero vendors") when the true answer is
// "the server errored and we do not know". Criterion C19 ERROR_TRUTHFUL, and
// the standing rule for this codebase: never render an empty list where an
// error belongs, and never a generic message -- the backend's OWN words.
//
// USAGE: hold a `loadError: string | null` beside the data, set it from
// errorMessage(err, "Couldn't load X") in the catch, and render
//
//     {loadError ? <LoadError message={loadError} onRetry={load} />
//      : rows.length === 0 ? <EmptyState/>
//      : <Table/>}
//
// The empty state must sit BEHIND the error branch, never beside it -- that
// ordering is the whole fix.

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

export default function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void | Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [attempts, setAttempts] = useState(0);

  async function retry() {
    if (!onRetry) return;
    setRetrying(true);
    setAttempts((n) => n + 1);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Card className="border-px-error-border bg-px-error-light">
      <CardContent className="space-y-3 p-4">
        {/* The backend's own words. A generic "something went wrong" here
            would hide which upstream is degraded and for how long. */}
        <p role="alert" className="text-sm text-px-error">
          {message}
        </p>
        {onRetry && (
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={retrying} onClick={retry}>
              {retrying ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Retrying…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 size-4" aria-hidden />
                  Retry
                </>
              )}
            </Button>
            {attempts > 1 && !retrying && (
              // Say the true thing after a couple of failures rather than
              // letting the user keep clicking a control that is not working.
              <span className="text-xs text-px-muted">
                Still failing after {attempts} attempts — the workspace backend is degraded, not your connection.
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Several screens load N independent sources at once (Procurement loads 8,
// Recruitment 5). Promise.all makes ONE failure blank all N; allSettled plus
// this banner keeps whatever DID load on screen beside an honest list of what
// did not. Same rule as EmployeesClient's already-shipped fix.
export function PartialLoadErrors({
  errors,
  onRetry,
}: {
  errors: string[];
  onRetry?: () => void | Promise<void>;
}) {
  if (errors.length === 0) return null;
  return (
    <Card className="border-px-error-border bg-px-error-light">
      <CardContent className="space-y-3 p-4">
        <p role="alert" className="text-sm font-medium text-px-error">
          {errors.length === 1
            ? "One part of this screen could not be loaded:"
            : `${errors.length} parts of this screen could not be loaded:`}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-px-error">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p className="text-xs text-px-muted">
          Anything still shown below loaded successfully; the sections named above are unknown, not empty.
        </p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={() => onRetry()}>
            <RefreshCw className="mr-2 size-4" aria-hidden />
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
