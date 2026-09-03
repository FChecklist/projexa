"use client";

// R67 WS-C (C-06) -- A DOOR, WRAPPED ROUND WHATEVER THE PAGE ALREADY DRAWS.
//
// The three doors R-170 names are a header button, a KPI number and a
// composer chip. The middle one lives on a page that already draws its own
// content -- a DashboardCard, a project name in a table cell -- so this
// component does not redraw any of that. It wraps it, and makes the wrapper
// the door.
//
// THREE RULES IT ENFORCES.
//
// 1. A KPI VALUE IS A REAL LINK. C-06: "Make every dashboard KPI value and
//    project row a real link with a chain." A <button> that calls router.push
//    is not a link: it cannot be middle-clicked, copied, opened in a new tab
//    or read as a destination by a screen reader. This renders next/link and
//    fills the strip from its onClick, so the navigation is the browser's and
//    the sentence is the shell's.
// 2. A NUMBER WITH NO DESTINATION IS NOT SHIPPED AS A DEAD NUMBER. Where the
//    tile genuinely has nothing behind it -- no permits on this project, no
//    BOQ yet -- the caller passes `disabledReason` and the door renders as
//    text with the reason beneath it, in words. Never a live link into an
//    empty screen that leaves the user to work out why.
// 3. IT NEVER EXECUTES. Filling a strip and opening a screen are both reads.

import Link from "next/link";
import type { ReactNode } from "react";
import { doorById, doorRoute } from "@/lib/card-catalogue";
import { useOpenDoor } from "./shell-chain-context";

export type ChainDoorProps = {
  /** A DOORS id from src/lib/card-catalogue.ts. */
  doorId: string;
  /** The project this door is scoped to, when it is scoped to one. */
  projectId?: string | null;
  /**
   * Why the door cannot be opened right now, in words the user can act on:
   * "No permits on this project". Non-empty renders text, not a link.
   */
  disabledReason?: string;
  className?: string;
  children: ReactNode;
};

export function ChainDoor({ doorId, projectId, disabledReason, className, children }: ChainDoorProps) {
  const openDoor = useOpenDoor();
  const door = doorById(doorId);

  // A door id that is not in the catalogue is a programming error, not a
  // user-facing state -- render the content untouched rather than a control
  // that leads nowhere.
  if (!door) return <div className={className}>{children}</div>;

  if (disabledReason) {
    return (
      <div className={className} aria-disabled data-door={doorId} style={{ opacity: 0.65 }}>
        {children}
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--color-ct-muted)" }}>
          {disabledReason}
        </p>
      </div>
    );
  }

  return (
    <Link
      href={doorRoute(door, projectId ?? null)}
      data-door={doorId}
      className={`block ${className ?? ""}`}
      // The link owns the navigation; the shell owns the sentence. Hence
      // navigate:false -- a push here would race the anchor and land twice.
      onClick={() => openDoor(doorId, { projectId, navigate: false })}
    >
      {children}
    </Link>
  );
}
