"use client";

// R67 WS-A (A-06) -- WHAT SENTENCE IS THIS SCREEN ALREADY IN?
//
// THE DEFECT. The composer's strip described whatever the user had last
// clicked, anywhere in the app. Arriving on /permits it still read
// "Work Progress × › New entry ×" -- a task belonging to another module, with
// its (×) controls still offering to edit it, sitting under a Permits heading.
// And with nothing clicked it read the kit's fixed "Select a module to begin"
// while the user was standing INSIDE a module, which is an instruction to do a
// thing already done.
//
// THE FIX IS THAT THE SENTENCE IS DERIVED FROM THE URL, not accumulated from
// clicks. A pathname answers four separate questions and this hook answers all
// four in one place, because answering them in four places is how they drift:
//
//   module        -- which module's PILLS these are, and therefore which pill
//                    would only point back at this screen (A-01). The
//                    Dashboard counts here: "Dashboard" must not be offered on
//                    /dashboard.
//   chainModule   -- what the STRIP already says. The same module, except the
//                    Dashboard, which IS the grouped module directory rather
//                    than a module: "Dashboard ›" is not the start of a
//                    sentence anyone finishes.
//   createSegment -- the third word on a create page ("… › Permits › New
//                    permit"), so the strip is a whole sentence rather than a
//                    sentence and a half.
//   shipped       -- whether this URL is a real page at all. An unshipped or
//                    mistyped route still gets the shell and a strip that says
//                    so, rather than a bare error with no way back.
//
// screenModuleFor() is pure and exported so every one of those answers can be
// asserted without a browser; the hook is a two-line wrapper over usePathname().

import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { isShippedRoute } from "@/lib/nav-routes";
import {
  chainModuleForPathname,
  createSegmentForPathname,
  moduleForPathname,
  normalisePathname,
  type ModuleDef,
} from "@/lib/module-catalogue";

export type ScreenModule = {
  /** The pathname these answers are about, normalised (no query, no hash). */
  pathname: string;
  /** The module this screen belongs to, Dashboard included. */
  module: ModuleDef | null;
  /** The module the STRIP should already be naming. Never the Dashboard. */
  chainModule: ModuleDef | null;
  /** The create page's own segment, when this URL is one. */
  createSegment: { id: string; label: string } | null;
  /** False when no page.tsx serves this URL -- a 404 in waiting. */
  shipped: boolean;
};

export function screenModuleFor(pathname: string): ScreenModule {
  const path = normalisePathname(pathname);
  return {
    pathname: path,
    module: moduleForPathname(path),
    chainModule: chainModuleForPathname(path),
    createSegment: createSegmentForPathname(path),
    // isShippedRoute() is the same registry nav-routes.test.ts regenerates from
    // the real src/app/**/page.tsx files in both directions, so this cannot
    // quietly drift from what actually renders.
    shipped: isShippedRoute(path),
  };
}

export function useScreenModule(): ScreenModule {
  const pathname = usePathname();
  return useMemo(() => screenModuleFor(pathname ?? "/"), [pathname]);
}
