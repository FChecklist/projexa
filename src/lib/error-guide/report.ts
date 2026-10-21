// The complete plain-text report "Copy details" puts on the clipboard: everything needed to understand or fix the problem without asking the
// person a single question. No typed values are included -- only the screen, the call, the status and the words.

import type { GuideContext } from "./types";
import type { ResolvedGuide } from "./match";

export function buildGuideReport(r: ResolvedGuide, ctx: GuideContext, now: Date = new Date()): string {
  const lines: string[] = [];
  lines.push("PROJEXA ERROR REPORT");
  lines.push(`Problem: ${r.title}`);
  lines.push(`Guide: ${r.guide.id} (${r.guide.source})`);
  lines.push(`When: ${now.toISOString()}`);
  lines.push(`Screen: ${ctx.route}${ctx.search || ""}`);
  lines.push(`Project: ${ctx.projectId ?? "none"}`);
  if (ctx.entityType || ctx.entityId) lines.push(`Record: ${ctx.entityType ?? "?"} ${ctx.entityId ?? ""}`.trim());
  if (ctx.field) lines.push(`Field: ${ctx.field}`);
  lines.push(`Server call: ${ctx.method ?? "?"} ${ctx.apiPath ?? "?"}`);
  lines.push(`Status: ${ctx.status === undefined ? "unknown" : ctx.status === 0 ? "0 (no answer)" : ctx.status}${ctx.code ? ` / code ${ctx.code}` : ""}`);
  lines.push(`Server words: ${ctx.serverMessage?.trim() || "(none)"}`);
  lines.push("");
  lines.push(`What happened: ${r.what}`);
  lines.push(`Why: ${r.why}`);
  lines.push("What to do:");
  r.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  if (r.fix) lines.push(`Where to fix it: ${r.fix.where} -> ${r.fix.href}`);
  return lines.join("\n");
}
