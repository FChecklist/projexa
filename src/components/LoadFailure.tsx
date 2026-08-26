"use client";

// R52 -- the visible half of R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01.
//
// fetchJson() (src/lib/fetch-json.ts) stops a failed request ever reaching a
// list setter, so `?? []` can no longer turn a 500 into an empty array. But
// a caught error that only raises a toast still leaves the SCREEN showing
// its empty state, and a toast is gone in seconds. The user comes back to
// "No vendors added yet." and has no reason to doubt it.
//
// So a failed read gets a persistent surface that is visually distinct from
// an empty one, carries the backend's OWN words, and offers a retry. Where
// this renders, the empty state must NOT: they are alternatives, never both.
//
// Criterion C19 ERROR_TRUTHFUL: "A clear error naming what failed."

export function LoadFailure({
  error,
  onRetry,
  className = "",
}: {
  error: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`rounded-md border border-px-error-border bg-px-error-light p-4 text-sm text-px-error ${className}`}
    >
      <p className="font-medium">This didn&apos;t load, so what you see below is incomplete.</p>
      {/* The backend's own message, verbatim. It is the only thing on screen
          that can tell an operator WHICH dependency failed. */}
      <p className="mt-1 break-words">{error}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 underline underline-offset-2 hover:no-underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}
