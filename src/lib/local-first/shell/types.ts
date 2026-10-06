// LOCAL-FIRST shell: the contract between the shell and a module's screens. See docs/local-first/ROUTE_TABLE.md for how to add one.

import type { ComponentType } from "react";
import type { Connectivity } from "../connectivity";
import type { ShellData } from "./context";
import type { FileQueue } from "./file-queue";
import type { ShellWriter } from "./pending-edits";

/** What the shell offers a screen (and its data adapter). Everything here is local to this laptop. */
export type ShellApi = {
  /** Who the person is, their organisation, their projects, and where the replica lives. */
  data: ShellData;
  /** The selected project (from the URL's ?projectId=, else the person's last choice, else their first), or null when they have none. */
  projectId: string | null;
  setProjectId(id: string): void;
  /** Writes go through this: kept on the laptop at once, sent when the laptop can reach the server. */
  writer: ShellWriter;
  /** Files waiting to be sent (permits, drawings, documents): kept on the laptop, uploaded first and the record queued after. */
  files: FileQueue;
  /** Moves to another screen without a page load. Accepts the app's own paths (/scope/abc). */
  navigate(href: string, options?: { replace?: boolean }): void;
  connectivity: Connectivity;
  /** Asks the shell to run the current screen's adapter again (after a write or a sync). */
  refresh(): void;
};

export type ShellScreenProps<D = unknown> = {
  shell: ShellApi;
  params: Record<string, string>;
  query: URLSearchParams;
  /** What the route's adapter returned. */
  data: D;
};

/**
 * One screen the shell can draw. Registering a module is one of these in route-table.ts.
 *  - pattern  the app's own path, ":name" for a parameter ("/scope", "/scope/:id")
 *  - load     the screen component, lazy-loaded so the shell's first paint stays small
 *  - adapter  reads the local database and returns what the screen needs; the shell shows "loading" while it runs and a calm message if it throws
 */
export type ShellRoute<D = any> = {
  pattern: string;
  title: string;
  /** Shows the route as a link in the shell's header. Lower order is further left. */
  nav?: { label: string; order: number };
  load: () => Promise<{ default: ComponentType<ShellScreenProps<D>> }>;
  adapter?: (shell: ShellApi, params: Record<string, string>, query: URLSearchParams) => Promise<D>;
};

export function defineShellRoute<D>(route: ShellRoute<D>): ShellRoute<D> {
  return route;
}
