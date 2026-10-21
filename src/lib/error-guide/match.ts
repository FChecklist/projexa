// The matcher: one failure in, ONE guide out -- always. The most specific guide wins; when nothing in the catalogue fits, a generic guide for the
// kind of failure is built on the spot (it shows the server's own words, a Retry when retrying is honest, and a link back to where the person was)
// and the miss is logged so the catalogue grows from real failures.

import { reportClientError } from "@/lib/local-first/client-error-report";
import { catalogue as defaultCatalogue } from "./catalogue";
import type { Guide, GuideContext, GuideSource } from "./types";
import { hereOf, pathOf, withParam } from "./urls";

const WEIGHT = { code: 8, messageRegex: 6, apiPath: 5, field: 4, status: 3, method: 2 } as const;

function statusMatches(want: number | number[], got: number | undefined): boolean {
  if (got === undefined) return false;
  return Array.isArray(want) ? want.includes(got) : want === got;
}

/** How well a guide fits this failure: null = it does not fit; otherwise the sum of the weights of the keys it names (all of which matched). */
export function guideScore(guide: Guide, ctx: GuideContext): number | null {
  const m = guide.match;
  let score = 0;
  if (m.status !== undefined) {
    if (!statusMatches(m.status, ctx.status)) return null;
    score += WEIGHT.status;
  }
  if (m.code !== undefined) {
    if (ctx.code !== m.code) return null;
    score += WEIGHT.code;
  }
  if (m.messageRegex !== undefined) {
    let ok = false;
    try {
      ok = new RegExp(m.messageRegex, "i").test(ctx.serverMessage ?? "");
    } catch {
      ok = false;
    }
    if (!ok) return null;
    score += WEIGHT.messageRegex;
  }
  if (m.apiPath !== undefined) {
    if (!(ctx.apiPath ?? "").includes(m.apiPath)) return null;
    score += WEIGHT.apiPath;
  }
  if (m.method !== undefined) {
    if ((ctx.method ?? "").toUpperCase() !== m.method.toUpperCase()) return null;
    score += WEIGHT.method;
  }
  if (m.field !== undefined) {
    if (ctx.field !== m.field) return null;
    score += WEIGHT.field;
  }
  // A guide that names no key at all would match everything; it must not outrank anything, but it may match.
  return score;
}

/** The kind of failure this is, from what is known about it. */
export function sourceOf(ctx: GuideContext): GuideSource {
  const s = ctx.status;
  if (ctx.code === "OFFLINE" || ctx.code === "TIMEOUT" || s === 0) return "network";
  if (ctx.code === "NOT_SENT") return "validation";
  if (s === 401) return "auth";
  if (s === 403) return "permission";
  if (s === 409) return "conflict";
  if (s === 413 || s === 415) return "upload";
  if (s === 400 || s === 422) return "validation";
  if (s !== undefined && s >= 500) return "server";
  return "unknown";
}

const GENERIC: Record<GuideSource, { title: string; why: string; steps: string[]; retry: boolean; severity: Guide["severity"] }> = {
  validation: { title: "Please correct the entry", why: "Something that was entered is not acceptable. Nothing was saved.", steps: ["Check the highlighted entry.", "Correct it.", "Press Save again."], retry: false, severity: "block" },
  server: { title: "The server had a problem", why: "The server could not complete this. A full report has been saved so it can be fixed.", steps: ['Press "Try again".', 'If it keeps failing, press "Copy details" and send them to support.'], retry: true, severity: "block" },
  network: { title: "The server did not answer", why: "The connection dropped or the server was too slow.", steps: ["Check that this device is online.", 'Press "Try again".'], retry: true, severity: "warn" },
  auth: { title: "You were signed out", why: "Your sign-in is no longer valid.", steps: ["Sign in again; you come back to this screen."], retry: false, severity: "block" },
  permission: { title: "You are not allowed to do this", why: "Your role does not allow it.", steps: ["Ask the Owner or an Admin of your organisation for access."], retry: false, severity: "block" },
  prerequisite: { title: "Something must be set up first", why: "This needs something that does not exist yet.", steps: ["Set up what the message above asks for.", 'Then press "Try again".'], retry: true, severity: "warn" },
  conflict: { title: "Someone else changed this", why: "The record changed while you were working on it.", steps: ["Reload to see the latest version.", "Make your change again."], retry: false, severity: "warn" },
  upload: { title: "The file could not be accepted", why: "The file is too large or not of an accepted type.", steps: ["Choose a smaller file, or a PDF or image.", "Upload it again."], retry: false, severity: "block" },
  unknown: { title: "Something went wrong", why: "The cause is not known yet. A full report has been saved so it can be fixed.", steps: ['Press "Try again".', 'If it keeps failing, press "Copy details" and send them to support.'], retry: true, severity: "block" },
};

/** The fallback guide for a failure nothing in the catalogue fits. Always has a way back to where the person was. */
export function genericGuide(ctx: GuideContext): Guide {
  const source = sourceOf(ctx);
  const g = GENERIC[source];
  return {
    id: `generic-${source}`,
    source,
    match: {},
    title: g.title,
    what: ctx.serverMessage ? "The server said: {serverMessage}" : "The app could not finish what you asked.",
    why: g.why,
    steps: g.steps,
    fix: { label: source === "auth" ? "Sign in again" : "Back to where you were", to: (c) => (source === "auth" ? withParam("/login", "redirectTo", hereOf(c)) : hereOf(c)), where: source === "auth" ? "The sign-in page, then straight back here" : "The screen you were on" },
    retry: g.retry,
    severity: g.severity,
  };
}

let unmatchedLogger: (ctx: GuideContext) => void = (ctx) => {
  reportClientError("guide:unmatched", new Error(`unmatched: ${ctx.method ?? "?"} ${ctx.apiPath ?? "?"} -> ${ctx.status ?? "?"} ${ctx.code ?? ""} ${ctx.serverMessage ?? ""}`.trim()), ctx.route);
};
/** Test seam: replace (or restore with no argument) what an unmatched failure is logged through. */
export function setUnmatchedLogger(fn?: (ctx: GuideContext) => void): void {
  unmatchedLogger = fn ?? ((ctx) => reportClientError("guide:unmatched", new Error(`unmatched: ${ctx.method ?? "?"} ${ctx.apiPath ?? "?"} -> ${ctx.status ?? "?"} ${ctx.code ?? ""} ${ctx.serverMessage ?? ""}`.trim()), ctx.route));
}

const loggedMisses = new Set<string>();
function logMiss(ctx: GuideContext): void {
  const key = `${ctx.method ?? ""}|${pathOf(ctx.apiPath ?? "")}|${ctx.status ?? ""}|${ctx.code ?? ""}|${ctx.serverMessage ?? ""}`;
  if (loggedMisses.has(key)) return; // the same miss is told once, so a re-render cannot flood the log
  loggedMisses.add(key);
  try {
    unmatchedLogger(ctx);
  } catch {
    /* logging must never break the screen */
  }
}
/** Test seam. */
export function resetLoggedMisses(): void {
  loggedMisses.clear();
}

/** The guide for this failure. ALWAYS returns one. */
export function matchGuide(ctx: GuideContext, guides: Guide[] = defaultCatalogue): Guide {
  let best: Guide | null = null;
  let bestScore = -1;
  for (const g of guides) {
    const s = guideScore(g, ctx);
    if (s === null) continue;
    // A guide with an empty `match` would swallow every failure and hide the generic fallback's logging, so it never counts as a match.
    if (Object.keys(g.match).length === 0) continue;
    if (s > bestScore) {
      best = g;
      bestScore = s;
    }
  }
  if (best) return best;
  logMiss(ctx);
  return genericGuide(ctx);
}

export type ResolvedGuide = {
  guide: Guide;
  title: string;
  what: string;
  why: string;
  steps: string[];
  fix: { label: string; href: string; where: string; focus?: string } | null;
  retry: boolean;
  severity: Guide["severity"];
  returnLabel: string;
};

function fill(text: string, ctx: GuideContext): string {
  const words = (ctx.serverMessage ?? "").trim();
  return text.replace(/\{serverMessage\}/g, words || "No reason was given.").replace(/\s+/g, " ").trim();
}

/** The guide with its placeholders filled and its link worked out for this failure. */
export function resolveGuide(guide: Guide, ctx: GuideContext): ResolvedGuide {
  let fix: ResolvedGuide["fix"] = null;
  if (guide.fix) {
    const raw = typeof guide.fix.to === "function" ? guide.fix.to(ctx) : guide.fix.to;
    const focus = guide.fix.focus ?? (guide.source === "validation" ? ctx.field : undefined);
    fix = { label: guide.fix.label, href: focus ? withParam(raw, "focus", focus) : raw, where: guide.fix.where, focus };
  }
  return {
    guide,
    title: guide.title,
    what: fill(guide.what, ctx),
    why: fill(guide.why, ctx),
    steps: guide.steps.map((s) => fill(s, ctx)),
    fix,
    retry: guide.retry === true,
    severity: guide.severity,
    returnLabel: guide.returnLabel ?? "what you were doing",
  };
}
