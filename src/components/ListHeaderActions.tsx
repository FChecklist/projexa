"use client";

// R67 D-79 -- the header trio, once, for every tab of Manpower, Materials
// and Schedule.
//
// WHAT R-301 RECORDED. Each tab showed exactly one create button, and it was
// the one belonging to the tab you were already standing on. Marking
// attendance from the Roster meant finding the Attendance TAB first; logging
// time from the Gantt meant leaving the module entirely; the Cost Report and
// all four Schedule tabs had no header action at all. The destinations
// existed -- nothing on screen led to them.
//
// THE ORDER IS FIXED, and it is Filter | Export | + New. It is fixed because
// R-229's finding was that the same three controls appeared in a different
// order, or not at all, on nearly every list in the product: a user who
// learns where Export is on one screen must not have to look for it on the
// next.
//
// HOW "+ New" READS THE ITEM. D-79 calls it a "split button" whose "default
// action follows the active tab", and its acceptance says: "from /labour
// (Roster tab) click '+ New' -> menu shows 'Worker' and 'Attendance'; click
// 'Attendance' -> URL /labour/attendance/new (TWO CLICKS from the landing
// tab)". Two clicks is only true if the first one opens the menu, so "+ New"
// is one control that opens the module's whole create list, and the ACTIVE
// TAB'S OWN OBJECT IS FIRST in it -- which is what "default" buys the user in
// an open menu: the entry already under the pointer. The alternative reading
// (a primary that fires immediately) would make the acceptance's own click
// count wrong and would hide the other objects behind a second target.
//
// WHY THE MENU IS HAND-ROLLED RATHER THAN THE Radix DropdownMenu THIS REPO
// ALSO SHIPS. Radix's trigger opens on a real pointer sequence that happy-dom
// does not produce -- verified with a minimal probe against
// components/ui/dropdown-menu.tsx before writing this: neither
// fireEvent.pointerDown nor a keyboard Enter opens it in this test
// environment. A control whose whole behaviour is "it opens and lists these
// routes" that cannot be asserted anywhere but a browser is a control this
// programme cannot verify, and the brief forbids running a dev server. The
// pattern used instead is the one src/components/shell/TopRail.tsx already
// established and tested in this repo: real role="menu"/role="menuitem"
// elements, Escape and outside-click to close.
//
// DISABLED, NEVER HIDDEN. Filter and Export are rendered even where no
// handler exists yet, carrying a real reason -- a control a user can see and
// read the reason for is information; a control that is absent on this tab
// and present on the next is a puzzle.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Download, Filter as FilterIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createActionHref, createActionsFor, type CreateMenuModule } from "@/lib/module-create-routes";

export type ListHeaderActionsProps = {
  module: CreateMenuModule;
  /** The tab the user is on. Decides which object "+ New" offers first. */
  tab?: string | null;
  projectId?: string | null;
  /** Runs the module's filter. Omitted where none is built yet. */
  onFilter?: () => void;
  /** Why Filter cannot be used. Falls back to a generic, honest sentence. */
  filterDisabledReason?: string;
  onExport?: () => void;
  exportDisabledReason?: string;
  /**
   * Why a particular create action cannot be taken, keyed by its label --
   * "Attendance" needs a roster, "Receipt" needs a material master. The entry
   * stays in the menu and states the reason; removing it would leave the user
   * looking for a route that is simply not there today.
   */
  createDisabledReasons?: Record<string, string>;
};

export function ListHeaderActions({
  module,
  tab,
  projectId,
  onFilter,
  filterDisabledReason,
  onExport,
  exportDisabledReason,
  createDisabledReasons = {},
}: ListHeaderActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const actions = createActionsFor(module, tab);

  // Close on Escape and on a click anywhere else -- without both, the menu
  // covers the list the user was trying to get back to.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const choose = useCallback(
    (href: string, reason?: string) => {
      if (reason) return;
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const filterReason = onFilter ? undefined : (filterDisabledReason ?? "Filtering this list is not built yet");
  const exportReason = onExport ? undefined : (exportDisabledReason ?? "Exporting this list is not built yet");

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onFilter}
        disabled={Boolean(filterReason)}
        title={filterReason}
      >
        <FilterIcon className="size-4" aria-hidden /> Filter
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onExport}
        disabled={Boolean(exportReason)}
        title={exportReason}
      >
        <Download className="size-4" aria-hidden /> Export
      </Button>

      <div className="relative" ref={containerRef}>
        {/* The accessible name is the control's own written label, "+ New",
            because the plus is a glyph and a glyph has no name. */}
        <Button
          type="button"
          size="sm"
          aria-label="+ New"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Plus className="size-4" aria-hidden /> New
          <ChevronDown className="size-4" aria-hidden />
        </Button>

        {open && (
          <ul
            role="menu"
            aria-label={`New in ${module}`}
            className="absolute right-0 top-full z-50 mt-1 min-w-48 overflow-hidden rounded-md border border-px-border bg-white py-1 shadow-lg"
          >
            {actions.map((action) => {
              const reason = createDisabledReasons[action.label];
              const href = createActionHref(action, projectId);
              return (
                <li key={action.label}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(reason)}
                    title={reason}
                    onClick={() => choose(href, reason)}
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left text-[13px] text-ct-navy hover:underline disabled:cursor-not-allowed disabled:text-px-muted disabled:no-underline"
                  >
                    {action.label}
                    {/* The reason in WORDS under the entry, not only in a
                        title attribute nobody hovers. */}
                    {reason && <span className="text-[11px] text-px-muted">{reason}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ListHeaderActions;
