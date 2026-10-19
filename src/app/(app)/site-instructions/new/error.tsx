"use client";

// Never a bare "Internal Server Error" card: see CreateRouteError.tsx.
import CreateRouteError from "@/components/CreateRouteError";

export default function SiteInstructionNewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <CreateRouteError
      module="Site Instructions"
      moduleHref="/site-instructions"
      objectLabel="Site instruction"
      error={error}
      reset={reset}
    />
  );
}
