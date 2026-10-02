// LOCAL-FIRST: PROJEXA's own (internal) AI is OFF (package lf-e6; backend package lf-b3, compliance-tracker
// ai-os/PROJEXA_AI_OFF.md). The owner's order: "the user's own AI, never ours" -- cost near zero first.
//
// The backend refuses every internal-AI call while its switch PROJEXA_INTERNAL_AI_ENABLED is not exactly `1` (the shipped
// state). This file makes the LAPTOP side match, so the refusal never has to happen:
//   (a) the entry points that would reach a model on our server -- Discuss (`POST /api/discuss`) and the assistant
//       codeReferences that run a model (INTERNAL_AI_CODE_REFERENCES, through `POST /api/assistant`) -- do NOT call it while
//       internal AI is off. That saves the Vercel function, the compliance-tracker call and the refusal;
//   (b) instead they show ONE plain sentence (OWN_AI_SENTENCE) pointing at the person's own AI;
//   (c) never an error: no red toast, no "try again" (retrying never helps here).
//
// WHEN IS IT ON? Only when the sync manifest says so explicitly (`internal_ai: true`, or `features.internal_ai: true`), which a
// whole replica sync stores as `internalAi` with the manifest (replica.ts). The backend's manifest does not carry that field
// today, so on every laptop it is OFF -- the same default as the server. If the owner ever turns internal AI on, the backend
// adds the field and the laptop follows; nothing here has to change.
//
// The person's own AI keeps working with everything: the browser-AI surface `window.projexa.ai` (ai/webmcp.ts, BROWSER_AI.md),
// /llms.txt and the manual (/ai-manual.json), the AI link and its prompt chips. None of those use our models.

import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../replica";

/** What the person reads instead of an AI answer. One sentence, no blame, a way that works. */
export const OWN_AI_SENTENCE =
  "PROJEXA does not run its own AI — open your own AI assistant and paste your PROJEXA AI link (it can also read this app's /llms.txt); the buttons and menus still work.";

/** The backend's own refusal sentence (compliance-tracker src/lib/projexa-internal-ai.ts USE_YOUR_OWN_AI) and code. */
export const BACKEND_OWN_AI_SENTENCE = "PROJEXA does not run its own AI. Open your own AI assistant and paste your PROJEXA AI link. The buttons and menus still work.";
export const INTERNAL_AI_OFF_CODE = "PROJEXA_INTERNAL_AI_OFF";

/**
 * The assistant codeReferences whose server function runs a model (PROJEXA_AI_OFF.md "Named call sites"). Every other
 * codeReference is deterministic and keeps working. `detect_construction_budget_schedule_risk` is NOT here: with AI off it
 * answers from its deterministic template, which is a real answer.
 */
export const INTERNAL_AI_CODE_REFERENCES: ReadonlySet<string> = new Set(["generate_construction_progress_summary"]);

/** What a manifest says about internal AI: true / false when it says, null when it does not say (an older or today's backend). */
export function internalAiFlagFrom(manifest: unknown): boolean | null {
  if (typeof manifest !== "object" || manifest === null) return null;
  const m = manifest as { internal_ai?: unknown; features?: unknown };
  if (typeof m.internal_ai === "boolean") return m.internal_ai;
  if (typeof m.features === "object" && m.features !== null && typeof (m.features as { internal_ai?: unknown }).internal_ai === "boolean") {
    return (m.features as { internal_ai: boolean }).internal_ai;
  }
  return null;
}

/** True only when the stored manifest says internal AI is on. Anything else -- nothing stored, an error, no IndexedDB -- is OFF. */
export async function readInternalAiEnabled(userId: string | null, idb?: IDBFactory): Promise<boolean> {
  if (!userId) return false;
  const factory = idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!factory) return false;
  try {
    const db = await openLocalDb(factory, localDbNameFor(userId));
    try {
      return (await db.getMeta<StoredManifest>(MANIFEST_KEY))?.internalAi === true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

export type AiRequest = { route: "discuss" } | { route: "assistant"; codeReference: string };

/** Would this request reach a model on our server? */
export function usesInternalAi(req: AiRequest): boolean {
  return req.route === "discuss" || INTERNAL_AI_CODE_REFERENCES.has(req.codeReference);
}

/**
 * The guard every entry point calls BEFORE its fetch. `{ call: true }`: go ahead. `{ call: false, sentence }`: do not call the
 * server; show `sentence` as a calm answer (an assistant message, an info notice), never as an error.
 */
export async function guardInternalAi(
  req: AiRequest,
  deps: { enabled?: () => Promise<boolean> } = {},
): Promise<{ call: true } | { call: false; sentence: string }> {
  if (!usesInternalAi(req)) return { call: true };
  let enabled = false;
  try {
    enabled = deps.enabled ? await deps.enabled() : await readInternalAiEnabled(await activeUser());
  } catch {
    enabled = false;
  }
  return enabled ? { call: true } : { call: false, sentence: OWN_AI_SENTENCE };
}

export type ServerAiAnswer = { kind: "own_ai"; sentence: string } | { kind: "answer"; res: Response; body: unknown };

/**
 * THE one way an entry point reaches a server AI route: the guard first (nothing is sent while internal AI is off), then the
 * call, then the backend's own refusal recognised and turned into the same calm sentence. `send` is the screen's own fetch.
 * A network failure still throws, exactly as the screen's fetch did before.
 */
export async function callServerAi(req: AiRequest, send: () => Promise<Response>, deps: { enabled?: () => Promise<boolean> } = {}): Promise<ServerAiAnswer> {
  const gate = await guardInternalAi(req, deps);
  if (!gate.call) return { kind: "own_ai", sentence: gate.sentence };
  const res = await send();
  const body = await res.clone().json().catch(() => null);
  if (isInternalAiRefusal(res.status, body)) return { kind: "own_ai", sentence: OWN_AI_SENTENCE };
  return { kind: "answer", res, body };
}

/** A server answer that is the backend's own internal-AI refusal (should one still arrive): shown calmly, not as an error. */
export function isInternalAiRefusal(status: number, body: unknown): boolean {
  if (status !== 403 && status !== 200) return false;
  if (typeof body !== "object" || body === null) return false;
  const b = body as { error?: unknown; code?: unknown; ruleCode?: unknown; reply?: unknown };
  return b.code === INTERNAL_AI_OFF_CODE || b.ruleCode === INTERNAL_AI_OFF_CODE || b.error === BACKEND_OWN_AI_SENTENCE || (status === 403 && b.reply === BACKEND_OWN_AI_SENTENCE);
}

/** The person this laptop works for, from the laptop's own identity mirror only (no network: this guard must cost nothing). */
async function activeUser(): Promise<string | null> {
  try {
    const [{ createIdentityStore, getDurableIdentity }, { openDeviceMeta }] = await Promise.all([import("../identity"), import("../device-meta")]);
    const store = createIdentityStore({ storage: typeof localStorage === "undefined" ? null : localStorage, openMeta: () => openDeviceMeta() });
    return (await getDurableIdentity(store))?.userId ?? null;
  } catch {
    return null;
  }
}
