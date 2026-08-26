"use client";

// R52 Gate 2 (Flow) -- the client-side half of the defect ProjectLoadError
// fixes for server components.
//
// THE DEFECT, established from code rather than from the recorded symptom.
// src/lib/fetch-json.ts was written for R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01
// and documents "63 call sites across ~30 client components" doing:
//
//     const res  = await fetch("/api/things");
//     const data = await res.json();          // status never read
//     setThings(data.things ?? []);           // error body -> undefined -> []
//
// Only six components ever adopted the helper. Every client behind the R52
// REQUIRED Flow routes was still on the raw pattern, so a 4xx/5xx from the
// VERIDIAN proxy parsed cleanly as JSON, yielded undefined, and `?? []`
// rendered a confident empty state. The surrounding try/catch cannot save it:
// catch fires on a network or parse failure, never on an HTTP status.
//
// That is why A4S14_03 recorded "/floor-plans list is always empty" while the
// proxy was in fact failing, and it is the standing rule in this codebase:
// never render an empty list where an error belongs -- show the backend's OWN
// message.
//
// WHY IT RENDERS WHERE IT DOES. This box is deliberately placed BELOW the tab
// strip and the primary action on every page that adopts it, never above.
// R48_LAYOUT_REFLOW_01 is open in this same batch and is precisely about
// controls moving under the user's cursor after data resolves. An alert that
// appears post-load above the tabs would push every tab and every create
// button down by its own height -- reintroducing that defect while fixing this
// one. Below the controls, the error is fully visible and nothing the user was
// already aiming at moves.

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export default function DataLoadError({
  messages,
  onRetry,
}: {
  /** The backend's own words, one entry per failed call. Never a generic string. */
  messages: string[];
  onRetry: () => void;
}) {
  if (messages.length === 0) return null;

  return (
    <Card role="alert" className="border-px-error-border bg-px-error-light">
      <CardContent className="space-y-2 p-4 text-sm text-px-error">
        <p className="font-medium">
          {messages.length === 1
            ? "This data could not be loaded. Nothing below is missing because it is empty."
            : `${messages.length} requests failed. What is shown below is incomplete.`}
        </p>
        <ul className="list-disc space-y-0.5 pl-5">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 size-4" aria-hidden />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}
