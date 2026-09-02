// R67 lane D22 (items D-52/D-48/D-60): a receipt that survives the navigation
// that earned it.
//
// THE PROBLEM: an import finishes on /scope/import and lands the user on
// /scope/<newId>. The sentence that says what happened -- "BOQ Fit-out v1
// created - 128 lines, AED 1,254,300" -- has to appear on the page they land
// on, not the one they left. A toast is the wrong tool twice over: the kit's
// own MessageArea header says it plainly ("toasts vanish; errors must persist
// until resolved"), and a toast fired before router.push() races the
// navigation.
//
// THE MECHANISM: sessionStorage, keyed by the route the message is FOR, read
// once by that route and cleared. Session-scoped, not local, so a receipt can
// never resurface in a different tab or a week later. Taken exactly once, so a
// reload of the landing page does not re-announce an import that happened
// twenty minutes ago -- while the message itself stays on screen for as long
// as the component that took it is mounted, which is the "persistent" part.
//
// Every accessor is try/catch'd: sessionStorage throws outright in some
// privacy modes, and a blocked receipt must degrade to "no message", never to
// a crashed screen.

export type FooterMessageLevel = "success" | "info" | "warning" | "error";
export type FooterMessage = { level: FooterMessageLevel; text: string };

const KEY_PREFIX = "veri.footer.";

function storageKey(route: string): string {
  return `${KEY_PREFIX}${route}`;
}

/** Stashes a receipt for `route`, to be shown by the screen the user is about to land on. */
export function setFooterMessage(route: string, message: FooterMessage): void {
  try {
    sessionStorage.setItem(storageKey(route), JSON.stringify(message));
  } catch {
    // No receipt is survivable; a crash on the way to a successful navigation is not.
  }
}

/** Reads and CLEARS the receipt for `route`. Returns null when there is none, or when it cannot be trusted. */
export function takeFooterMessage(route: string): FooterMessage | null {
  try {
    const raw = sessionStorage.getItem(storageKey(route));
    if (!raw) return null;
    sessionStorage.removeItem(storageKey(route));
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { level, text } = parsed as Partial<FooterMessage>;
    if (typeof text !== "string" || !text) return null;
    const validLevel: FooterMessageLevel =
      level === "error" || level === "warning" || level === "info" || level === "success" ? level : "success";
    return { level: validLevel, text };
  } catch {
    return null;
  }
}

/** Drops a receipt without showing it -- used when a flow is abandoned rather than completed. */
export function clearFooterMessage(route: string): void {
  try {
    sessionStorage.removeItem(storageKey(route));
  } catch {
    // Same reasoning as setFooterMessage.
  }
}
