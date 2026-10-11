// "Did it work?" for the website way of connecting (owner order 2026-10-11: mistakes must be identified and told to the person).
//
// PROJEXA cannot see inside ChatGPT's or Gemini's website, but it CAN see when an AI uses the person's code: every link row carries `lastUsedAt`
// (compliance-tracker ai_work_link_list, the same row the "my links" screen reads). So the check compares that time with the moment the wizard made
// the code, and answers in one of five plain states. Pure functions of data, so they are tested without a browser.
import type { AwlLinkRow } from "@/lib/ai-work-link-core";

export type Diagnosis =
  | { state: "connected"; title: string; detail: string }
  | { state: "waiting"; title: string; detail: string; tryThese: string[] }
  | { state: "no-code"; title: string; detail: string }
  | { state: "expired"; title: string; detail: string }
  | { state: "unreachable"; title: string; detail: string };

const MINUTE = 60_000;

/** "just now", "3 minutes ago", "2 hours ago": the time since `iso`, in the words a person uses. */
export function agoWords(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (ms < 45_000) return "just now";
  if (ms < 90 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))} minute${Math.round(ms / MINUTE) === 1 ? "" : "s"} ago`;
  if (ms < 36 * 60 * MINUTE) return `${Math.round(ms / (60 * MINUTE))} hours ago`;
  return `${Math.round(ms / (24 * 60 * MINUTE))} days ago`;
}

/** The person's current code: the newest "all my projects" link that is not revoked. */
export function currentCode(rows: AwlLinkRow[]): AwlLinkRow | null {
  // a row that does not say its scope is the person's all-projects link only when it names no project
  const mine = rows.filter((r) => (r.scope === "user" || (r.scope === undefined && r.projectId === "")) && r.revokedAt === null);
  mine.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return mine[0] ?? null;
}

/**
 * @param rows        the person's links as the service lists them, or null when the list could not be read (offline, service down)
 * @param madeAfter   ISO time the wizard made the code in this panel, or null when the person only opened the panel (an old code may exist)
 * @param aiName      "ChatGPT", "Grok" ...
 * @param mistakes    that AI's usual mistakes (connect-your-ai-providers.ts), shown when nothing has happened yet
 */
export function diagnoseConnection(rows: AwlLinkRow[] | null, madeAfter: string | null, now: Date, aiName: string, mistakes: string[]): Diagnosis {
  if (rows === null) {
    return { state: "unreachable", title: "I could not check right now.", detail: "PROJEXA could not be reached, so I cannot see whether your AI has connected. Check your internet and press the check button again." };
  }
  const code = currentCode(rows);
  if (!code) {
    return { state: "no-code", title: "There is no PROJEXA code yet.", detail: "Press \"Make my PROJEXA code\" in step 1 first, then follow the steps on the AI's website." };
  }
  if (code.status !== "active") {
    return { state: "expired", title: "Your PROJEXA code has expired.", detail: "Press \"Make my PROJEXA code\" again and paste the NEW address into your AI. The old one no longer works." };
  }
  const used = code.lastUsedAt;
  const afterMake = used !== null && (madeAfter === null || new Date(used).getTime() >= new Date(madeAfter).getTime() - MINUTE);
  if (used !== null && afterMake) {
    return { state: "connected", title: `Connected. ${aiName} used PROJEXA ${agoWords(used, now)}.`, detail: `Your ${aiName} can now work in PROJEXA for you, inside your role. Try: \"Show my PROJEXA projects\", then \"Create a project called ...\".` };
  }
  return {
    state: "waiting",
    title: `Not yet: ${aiName} has not used your code.`,
    detail: `PROJEXA made your code${madeAfter ? ` ${agoWords(madeAfter, now)}` : ""}, but ${aiName} has not called PROJEXA since. It usually takes a few seconds after you ask it something. Do this: open a NEW chat in ${aiName}, type \"Show my PROJEXA projects\", wait, then press the check button again. If it still says not yet, these are the usual reasons:`,
    tryThese: mistakes,
  };
}
