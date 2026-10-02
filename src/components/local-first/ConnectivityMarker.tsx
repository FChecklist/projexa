"use client";

// LOCAL-FIRST: the ONE visible sign that this laptop cannot reach our servers. A tiny dot and one calm sentence. It is not a
// dialog, not an alert, not a banner: it takes no focus, blocks nothing and asks for nothing, because being offline (or our
// server being down) is not a problem the person has to solve -- PROJEXA keeps working from the laptop's own copy and syncs when
// it can. While everything is fine it renders nothing at all.

import { WORKING_LOCALLY_TEXT, useConnectivity, type Connectivity } from "@/lib/local-first/connectivity";

export function ConnectivityMarkerView({ state, className = "" }: { state: Connectivity; className?: string }) {
  if (state === "online") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connectivity-marker"
      data-state={state}
      className={`pointer-events-none inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2 py-0.5 text-[11px] leading-4 text-px-muted shadow-sm ${className}`}
    >
      <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: "var(--color-ct-saffron, #F5820A)" }} />
      <span>{WORKING_LOCALLY_TEXT}</span>
    </div>
  );
}

/** Reads the shared connectivity state. `state` is for tests and previews. */
export function ConnectivityMarker({ state, className }: { state?: Connectivity; className?: string }) {
  const live = useConnectivity();
  return <ConnectivityMarkerView state={state ?? live} className={className} />;
}

/**
 * The same marker pinned small in a corner of every screen, mounted once by LocalFirstBoot. The on-laptop shell shows its own marker in
 * its header and says so by setting data-px-shell on <html>, so the two never appear together.
 */
export function FloatingConnectivityMarker() {
  const live = useConnectivity();
  if (live === "online") return null;
  if (typeof document !== "undefined" && document.documentElement.dataset.pxShell === "1") return null;
  return (
    <div className="pointer-events-none fixed bottom-2 right-3 z-40">
      <ConnectivityMarkerView state={live} />
    </div>
  );
}
