// LOCAL-FIRST (AUDIT-100 A3, VERCEL_ROUTE_PLAN.md step 1): hand the person over from a server-rendered page to the on-laptop shell.
//
// THE PROBLEM IT CLOSES (measured, e2e/lf-lifecycle-vercel-budget.spec.ts): after the one-time install the person was still on the legacy,
// server-rendered page they signed in to (/dashboard, /scope ...). That page's links are Next.js client navigations (RSC fetches, plus link
// prefetches), and the service worker deliberately never answers those (sw-core.ts: "RSC payloads ... the network"). So the whole first
// session stayed on Vercel until the person happened to do a full page load: 20 app pages and 4 /api calls in the measurement.
//
// WHAT IT DOES, only when the shell is really there (a service worker controls the page, its pointer names an installed release of THIS
// person, local-first mode is on -- exactly the condition in which sw-core.ts answers a navigation with the shell):
//   * handOff(): ONE location.replace of the current address, which the worker answers with the shell from the laptop. It is done at a
//     moment the person cannot lose anything: not when the address asks for the server's page on purpose (px-server: the shell sent the
//     person there for a screen it does not have), not while a field is being edited, not twice for the same address in a short while
//     (a worker that would not answer with the shell must never cause a reload loop);
//   * armLinkHandoff(): until then, a plain click on an in-app link becomes a full navigation (answered by the worker) instead of an RSC fetch.
// Pure decisions + injected browser pieces, so it is unit-tested without a browser (shell-handoff.test.ts).

import { SERVER_PAGE_PARAM, isShellNavigable } from "../shell/paths";
import { isPublicPagePath } from "@/lib/authz/page-access";
import type { SwClient } from "./sw-client";

/** Dispatched on window when the release has just been installed or the worker's pointer was just set (WorkspacePrepare, boot). */
export const SHELL_READY_EVENT = "px:local-shell-ready";

// A copy of the person's projects running in THIS page (the prepare screen's projects step, its quiet retry) must not be cut off by the
// replace: the shell does not restart a whole sync by itself. While one runs, handOff() answers "busy"; the runner announces again when done.
let busyCount = 0;
/** Marks a projects copy running in this page (returns the "done" call). */
export function markCopying(): () => void {
  busyCount += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    busyCount = Math.max(0, busyCount - 1);
  };
}
export const copyingNow = (): boolean => busyCount > 0;

/** The same address is not replaced twice within this long (a loop guard, see the header). */
export const HANDOFF_REPEAT_MS = 60_000;
const HANDOFF_KEY = "px-shell-handoff";

export type HandoffStatus = { ok?: boolean; version?: unknown; personId?: unknown; localFirst?: unknown; signedOut?: unknown } | null;

/** True when the worker would answer a navigation with the shell for this person. */
export function shellServes(status: HandoffStatus, personId: string | null, hasController: boolean): boolean {
  if (!hasController || !status || status.ok !== true) return false;
  if (typeof status.version !== "string" || !status.version) return false;
  if (status.signedOut === true || status.localFirst !== true) return false;
  return personId === null || status.personId === null || status.personId === undefined || status.personId === personId;
}

/** True when this address must stay on the server's page (it asked for it, or it is not an app page at all). */
export function mustStayOnServer(pathname: string, search: string): boolean {
  if (new URLSearchParams(search).has(SERVER_PAGE_PARAM)) return true;
  if (pathname === "/local" || pathname.startsWith("/local/")) return true; // already the shell
  return isPublicPagePath(pathname);
}

export type HandoffEnv = {
  location: { href: string; pathname: string; search: string; origin: string; replace(url: string): void; assign(url: string): void };
  /** sessionStorage (the loop guard); null when blocked. */
  session: Pick<Storage, "getItem" | "setItem"> | null;
  /** True while the person is typing in a field (activeElement is editable). */
  isEditing: () => boolean;
  /** A projects copy is running in this page. Default: copyingNow(). */
  isBusy?: () => boolean;
  now?: () => number;
};

export type HandoffResult = "handed_off" | "not_ready" | "stay_on_server" | "editing" | "busy" | "repeat";

/** Replaces the current page with the shell, once, when it is safe (see the header). */
export async function handOff(deps: { sw: Pick<SwClient, "status">; personId: string | null; hasController: () => boolean; env: HandoffEnv }): Promise<HandoffResult> {
  const { env } = deps;
  if (mustStayOnServer(env.location.pathname, env.location.search)) return "stay_on_server";
  if (!shellServes(await deps.sw.status().catch(() => null), deps.personId, deps.hasController())) return "not_ready";
  if (env.isEditing()) return "editing";
  if ((env.isBusy ?? copyingNow)()) return "busy";
  const now = (env.now ?? Date.now)();
  try {
    const last = JSON.parse(env.session?.getItem(HANDOFF_KEY) ?? "null") as { href?: string; at?: number } | null;
    if (last && last.href === env.location.href && typeof last.at === "number" && now - last.at < HANDOFF_REPEAT_MS) return "repeat";
    env.session?.setItem(HANDOFF_KEY, JSON.stringify({ href: env.location.href, at: now }));
  } catch {
    return "repeat"; // the loop guard cannot be kept: do not risk a reload loop
  }
  env.location.replace(env.location.href);
  return "handed_off";
}

type ClickLike = {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: unknown;
  preventDefault(): void;
  stopImmediatePropagation(): void;
};

type AnchorLike = { getAttribute(name: string): string | null; hasAttribute(name: string): boolean; href: string };

/** The in-app address a plain click on a link should load as a full navigation, or null when the click is not ours to change. */
export function fullNavigationTarget(event: ClickLike, origin: string): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const el = event.target as { closest?: (selector: string) => AnchorLike | null } | null;
  const anchor = el && typeof el.closest === "function" ? el.closest("a[href]") : null;
  if (!anchor) return null;
  const target = anchor.getAttribute("target");
  if ((target && target !== "_self") || anchor.hasAttribute("download")) return null;
  const raw = anchor.getAttribute("href") ?? "";
  if (!raw || raw.startsWith("#")) return null;
  if (!isShellNavigable(anchor.href, origin)) return null;
  const url = new URL(anchor.href, origin);
  if (isPublicPagePath(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

/** From now on a plain click on an in-app link is a full navigation (answered by the worker with the shell). Returns the undo. */
export function armLinkHandoff(win: { addEventListener: Window["addEventListener"]; removeEventListener: Window["removeEventListener"] }, env: Pick<HandoffEnv, "location">): () => void {
  const onClick = (e: Event) => {
    const to = fullNavigationTarget(e as unknown as ClickLike, env.location.origin);
    if (!to) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    env.location.assign(to);
  };
  win.addEventListener("click", onClick, true);
  return () => win.removeEventListener("click", onClick, true);
}

/** activeElement is a field the person types in. */
export function editingNow(doc: { activeElement: Element | null } | null): boolean {
  const el = doc?.activeElement as (Element & { isContentEditable?: boolean }) | null | undefined;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/** Tells the (app) pages that the shell may be ready now (best effort; nothing listens on the shell itself). */
export function announceShellReady(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SHELL_READY_EVENT));
  } catch {
    /* no window */
  }
}
