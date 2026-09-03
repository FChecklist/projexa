"use client";

// R67 WS-C (C-06) -- THE THREE DOORS SHARE ONE HANDLE.
//
// R-170: the same work is reachable three ways -- a module's own header
// button, a KPI number on a dashboard, and a card or pill in the composer --
// and until now only the third of those filled the control strip. Pressing
// "+ Mark Attendance" navigated and left the strip reading "Select a module
// to begin" on the very screen it had just opened, which is the shell
// contradicting itself.
//
// The strip lives in M24Shell, and every page in the product renders as that
// shell's children, so the shell is the one component that can fill it. This
// context is the handle it hands down.
//
// *** NOTHING HERE EXECUTES. *** `loadChain` fills the strip; `openDoor`
// fills it and opens a screen. Opening a screen is a read. The write is still
// a deliberate Save on that screen's own form, or a deliberate Send in the
// composer -- which is why this context has no `run`, no `submit` and no way
// to express one.
//
// THE DEFAULT IS A NO-OP, ON PURPOSE. A page rendered outside the shell (a
// unit test, a future embed) must still render. A missing provider is not a
// crash and is not a silent lie either: the control still navigates, it just
// does not fill a strip that is not on screen.

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Chain } from "@fchecklist/veridian-ui-kit/shell";
import { doorById, doorRoute } from "@/lib/card-catalogue";

/** A receipt for something a page's own form just saved. */
export type ShellReceipt = { text: string; href: string };

export type ShellChainApi = {
  /**
   * False when no provider is above this component -- the no-op default. A
   * control reads it so it can still navigate on its own rather than becoming
   * a button that does nothing at all.
   */
  hasShell: boolean;
  /**
   * Fill the control strip with this chain, and open `route` when one is
   * given. The kit's own loadChain() shape, exposed to the pages.
   */
  loadChain: (chain: Chain, route?: string) => void;
  /**
   * Open one of src/lib/card-catalogue.ts's DOORS: fill the strip with its
   * sentence, adopt its project, and open its screen.
   *
   * `navigate: false` fills the strip and stops -- for a door whose screen is
   * already open, where a push would only re-enter the route the user is
   * standing on and could drop the query it arrived with.
   */
  openDoor: (doorId: string, opts?: { projectId?: string | null; navigate?: boolean }) => void;
  /**
   * C-06: "on Save from such a page the same receipt line still appears in
   * band 2". A multi-field create route IS the card -- band 2 stays empty
   * while the form is open -- so the page reports its own save back here.
   */
  pushReceipt: (receipt: ShellReceipt) => void;
};

const NO_SHELL: ShellChainApi = {
  hasShell: false,
  loadChain: () => {},
  openDoor: () => {},
  pushReceipt: () => {},
};

const ShellChainContext = createContext<ShellChainApi>(NO_SHELL);

export function ShellChainProvider({ value, children }: { value: ShellChainApi; children: ReactNode }) {
  return <ShellChainContext.Provider value={value}>{children}</ShellChainContext.Provider>;
}

/** The shell's chain handle. Safe outside the shell: every member is a no-op. */
export function useShellChain(): ShellChainApi {
  return useContext(ShellChainContext);
}

/**
 * What a module's own header button calls. One line at each of the five call
 * sites C-06 names, and the fallback for "no shell above me" is written once
 * here rather than five times: a page rendered outside the shell still
 * navigates, it simply does not fill a strip that is not on screen.
 */
export function useOpenDoor(): (
  doorId: string,
  opts?: { projectId?: string | null; navigate?: boolean }
) => void {
  const shell = useShellChain();
  const router = useRouter();
  return useCallback(
    (doorId: string, opts?: { projectId?: string | null; navigate?: boolean }) => {
      shell.openDoor(doorId, opts);
      if (shell.hasShell || opts?.navigate === false) return;
      const door = doorById(doorId);
      if (door) router.push(doorRoute(door, opts?.projectId ?? null));
    },
    [shell, router]
  );
}
