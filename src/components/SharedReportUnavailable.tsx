import { UNAVAILABLE_COPY, type UnavailableReason } from "@/lib/shared-report";

// Public (no session, no app chrome). The PAGE supplies the one <main> landmark (single-main-landmark rule). Server-renderable: no hooks, no client code.
const MAIN: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "sans-serif" };

/** A plain, public "cannot be shown" page: says why and what to do. Never a 500. */
export function SharedReportUnavailable({ reason, openHref, openLabel }: { reason: UnavailableReason; openHref?: string; openLabel?: string }) {
  const copy = UNAVAILABLE_COPY[reason];
  return (
    <div style={MAIN} data-testid="shared-report-unavailable" data-reason={reason}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>{copy.title}</h1>
      <p style={{ fontSize: "0.9375rem", color: "#444" }}>{copy.why}</p>
      {reason === "wrong-page" && openHref && (
        <p style={{ marginTop: "1rem" }}><a href={openHref}>{openLabel ?? "Open the shared report"}</a></p>
      )}
    </div>
  );
}
