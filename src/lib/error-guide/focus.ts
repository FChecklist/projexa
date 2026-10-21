// ARRIVING AT THE EXACT PLACE. A fix link ends in ?focus=<id>: the screen scrolls to that element, outlines it for 3 seconds and announces it to
// screen readers. The element is found by data-testid, then id, then name; if the screen is still drawing it, the search is repeated briefly.

export const FOCUS_PARAM = "focus";
export const HIGHLIGHT_MS = 3000;
/** A FILE box keeps its outline until a file is chosen (or this long): it is small, and the page that owns it is often slow when a fault is shown. */
export const FILE_HIGHLIGHT_MS = 20000;
const SEARCH_EVERY_MS = 100;
const SEARCH_FOR_MS = 3000;
export const LIVE_REGION_ID = "px-focus-announcer";

function cssEscape(v: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
}

export function findFocusTarget(id: string, doc: Document = document): HTMLElement | null {
  const e = cssEscape(id);
  return (
    doc.querySelector<HTMLElement>(`[data-testid="${id.replace(/["\\]/g, "\\$&")}"]`) ??
    doc.getElementById(id) ??
    doc.querySelector<HTMLElement>(`[name="${id.replace(/["\\]/g, "\\$&")}"]`) ??
    (e ? doc.querySelector<HTMLElement>(`#${e}`) : null)
  );
}

function announce(text: string, doc: Document): void {
  let region = doc.getElementById(LIVE_REGION_ID);
  if (!region) {
    region = doc.createElement("div");
    region.id = LIVE_REGION_ID;
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
    doc.body.appendChild(region);
  }
  region.textContent = "";
  // a changed text is what a screen reader announces
  region.textContent = text;
}

function labelOf(el: HTMLElement, doc: Document): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const id = el.getAttribute("id");
  if (id) {
    const lab = doc.querySelector(`label[for="${id.replace(/["\\]/g, "\\$&")}"]`);
    if (lab?.textContent?.trim()) return lab.textContent.trim();
  }
  return (el.getAttribute("data-testid") || el.getAttribute("name") || id || "the highlighted item").trim();
}

/** Scrolls to the element, outlines it for 3 s, focuses it when it can be focused, and announces it. Returns false if it is not on the screen. */
export function highlightElement(el: HTMLElement, doc: Document = document): void {
  try {
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  } catch {
    /* old browsers */
  }
  const previous = { outline: el.style.outline, offset: el.style.outlineOffset };
  el.style.outline = "3px solid #D97706";
  el.style.outlineOffset = "2px";
  el.setAttribute("data-px-highlighted", "true");
  try {
    if (!el.hasAttribute("tabindex") && !/^(input|select|textarea|button|a)$/i.test(el.tagName)) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  } catch {
    /* not focusable */
  }
  announce(`Highlighted: ${labelOf(el, doc)}. This is the place to correct.`, doc);
  const clear = () => {
    el.style.outline = previous.outline;
    el.style.outlineOffset = previous.offset;
    el.removeAttribute("data-px-highlighted");
  };
  if (el instanceof HTMLInputElement && el.type === "file") {
    // The person is ending the outline by doing the correction: choosing a file.
    const timer = setTimeout(clear, FILE_HIGHLIGHT_MS);
    el.addEventListener("change", () => { clearTimeout(timer); clear(); }, { once: true });
    return;
  }
  setTimeout(clear, HIGHLIGHT_MS);
}

/** Looks for the element until it appears (the screen may still be loading) and highlights it. Returns a cancel function. */
export function focusOnArrival(id: string, doc: Document = document): () => void {
  let stopped = false;
  let waited = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const attempt = () => {
    if (stopped) return;
    const el = findFocusTarget(id, doc);
    if (el) {
      highlightElement(el, doc);
      return;
    }
    waited += SEARCH_EVERY_MS;
    if (waited <= SEARCH_FOR_MS) timer = setTimeout(attempt, SEARCH_EVERY_MS);
  };
  attempt();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
