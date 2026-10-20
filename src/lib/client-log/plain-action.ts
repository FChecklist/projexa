// The words for a write in the project timeline: "Saved a BOQ", "Approved a BOQ", "Deleted a permit" -- what a person did, not a URL.
// Used when the browser records the write (fetch-capture.ts) and again when the timeline is shown, so rows stored by an older build
// ("Update · scope", "Create Permit") read the same way.

import { routePattern } from "./fingerprint";

const NOUNS: Record<string, string> = {
  scope: "BOQ",
  "work-progress": "progress entry",
  moms: "meeting minutes",
  rfis: "RFI",
  ffe: "FFE item",
  kpis: "KPI",
  "kpi-entries": "KPI entry",
  "change-orders": "change order",
  "billing-claims": "billing claim",
  "site-diary": "site diary entry",
  "punch-list": "punch-list item",
};
const ACTION_WORDS: Record<string, string> = { approve: "Approved", reject: "Rejected", submit: "Submitted", cancel: "Cancelled", void: "Voided", revise: "Revised", import: "Imported", export: "Exported", publish: "Published", close: "Closed", reopen: "Reopened" };

function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("ses") || w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

export function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) && !/^(uni|use|eu)/i.test(noun) ? "an" : "a"} ${noun}`;
}

/** Writes that are the app talking to itself (drafts being auto-kept, preferences, sync), not something the person did. */
const BACKGROUND_PREFIXES = ["/api/local-first/", "/api/screen-drafts", "/api/user-preference", "/api/pill-usage", "/api/cache", "/api/classify", "/api/client-logs"];
export function isBackgroundWrite(path: string): boolean {
  return BACKGROUND_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));
}

/** "Saved a BOQ" for PATCH /api/scope/<id>; "Approved a BOQ" for POST /api/scope/<id>/approve. */
export function describeWrite(method: string, path: string): string {
  const segs = routePattern(path).split("/").filter((s) => s && s !== "api" && s !== ":id");
  const last = segs.length > 1 ? segs[segs.length - 1]!.toLowerCase() : "";
  const special = ACTION_WORDS[last];
  const verb = special ?? (method === "DELETE" ? "Deleted" : method === "POST" ? "Created" : "Saved");
  const head = segs[0] ?? "";
  const noun = NOUNS[head.toLowerCase()] ?? (head ? singular(head.replace(/[-_]/g, " ")) : "item");
  return `${verb} ${withArticle(noun)}`;
}

const PAST: Record<string, string> = { create: "Created", "create or run": "Created", update: "Saved", delete: "Deleted" };

/** Older stored names ("Update · scope", "Create Permit") in the same plain words; anything else is returned as it was. */
export function plainActionName(name: string): string {
  const legacy = /^(Create or run|Update|Delete) · (.*)$/.exec(name);
  if (legacy) {
    const verb = PAST[legacy[1]!.toLowerCase()]!;
    const parts = legacy[2]!.split(" / ");
    const head = parts[0]!.trim();
    const tail = parts.length > 1 ? parts[parts.length - 1]!.trim().toLowerCase() : "";
    const word = ACTION_WORDS[tail];
    const noun = NOUNS[head.replace(/ /g, "-").toLowerCase()] ?? singular(head);
    return `${word ?? verb} ${withArticle(noun || "item")}`;
  }
  const created = /^Create (.+)$/.exec(name);
  if (created) return `Created ${withArticle(created[1]!.trim().toLowerCase())}`;
  return name;
}
