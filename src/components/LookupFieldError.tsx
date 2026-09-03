"use client";

// R67 F-19 -- what a create form says when one of its dropdown lookups failed.
//
// The whole sentence lives in ONE element so it reads as one sentence:
// "Couldn't load subcontractors — Retry". The Retry is a real button inside
// it, not a separate line, because the failure and the thing to do about it
// are one thought. GLOBAL: a failure names what failed and offers the next
// action; an empty dropdown that silently means "the lookup 500'd" does
// neither.
import type { Lookup } from "@/lib/use-lookup";

export function LookupFieldError({ lookup }: { lookup: Lookup<unknown> }) {
  if (lookup.status !== "error") return null;
  return (
    <p role="alert" className="text-xs text-px-error">
      Couldn&apos;t load {lookup.label} —{" "}
      <button type="button" onClick={lookup.retry} className="underline underline-offset-2">
        Retry
      </button>
    </p>
  );
}

export default LookupFieldError;
