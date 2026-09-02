"use client";

// R67 D-55 / correction C-06: never a bare "Internal Server Error" card. This
// route-scoped boundary renders inside the M24 shell with the breadcrumb,
// says what failed, and offers Retry and Back. See CreateRouteError.tsx for
// the whole reasoning.
import CreateRouteError from "@/components/CreateRouteError";

export default function PermitNewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <CreateRouteError
      module="Permits"
      moduleHref="/permits"
      objectLabel="Permit"
      error={error}
      reset={reset}
    />
  );
}
