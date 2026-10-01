// LOCAL-FIRST slice 2, the one proof screen: the BOQ Object Page's line items, read from the laptop's own
// copy first. Everything here is behind the localStorage flag `px-local-first` = "1" (local-reader.ts); with
// the flag off every function returns null and the screen behaves exactly as it did before.
//
// HOW IT FITS THE EXISTING SCREEN
//   * The screen is opened by BOQ id; the replica is organised by project id. The first time a BOQ is opened
//     the screen loads the usual way (server) and remembers that BOQ's header and project on this laptop
//     (rememberBoq). Later visits find the project, ask the replica for its `boq_lines`, and keep this BOQ's own
//     lines (the replica holds the project's lines of every BOQ and revision, like the gateway's pages).
//   * Reading goes through loadLocalFirst (the same core useLocalFirst uses): the replica's rows when that
//     (project, kind) was synced to the end, otherwise null so the screen's existing loader runs.
//   * After either path the screen asks the replica to pull changes in the background (revalidateBoq).
//
// WHAT STAYS ON THE SERVER, ON PURPOSE (owner safeguard: browser data is a cache and a proposal, never authority)
//   writes (PATCH /api/scope/line-items/...), submit/approve, the money grid (BoqDualViewGrid reads the cost columns
//   through the proxy), and every figure that decides money. Local rows are for reading and display.

import type { Boq } from "@/lib/boq-helpers";
import type { GatewayBoqLine } from "@/lib/boq-gateway-client";
import { orderLinesForBoq, toBoqLineItemRow, type BoqScreenLoad } from "@/lib/boq-read-source";
import { isLocalFirstEnabled, loadLocalFirst, type LocalAccess } from "./local-reader";

/** The kind name the sync service uses for BOQ line items. */
export const BOQ_LINES_KIND = "boq_lines";

const hintKey = (boqId: string) => `px-local-first-boq:${boqId}`;

function isBoqHeader(v: unknown): v is Boq {
  return typeof v === "object" && v !== null && typeof (v as Boq).id === "string" && typeof (v as Boq).projectId === "string";
}

/** The replica's rows are untrusted input until they look like a line of a BOQ: anything else is skipped. */
export function isGatewayLine(v: unknown): v is GatewayBoqLine {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.boqId === "string" && typeof o.description === "string"
    && typeof o.unit === "string" && typeof o.quantity === "string" && typeof o.rate === "string" && typeof o.amount === "string";
}

/** Remembers a BOQ's header on this laptop so the next visit can find its project. No-op with the flag off. */
export function rememberBoq(boq: Boq): void {
  if (!isLocalFirstEnabled()) return;
  try {
    localStorage.setItem(hintKey(boq.id), JSON.stringify(boq));
  } catch {
    /* storage full or blocked: the next visit simply loads from the server again */
  }
}

function readHint(boqId: string): Boq | null {
  try {
    const raw = localStorage.getItem(hintKey(boqId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isBoqHeader(parsed) && parsed.id === boqId ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The BOQ as the screen takes it, built from the laptop's copy; null whenever the copy cannot answer (flag off, BOQ never opened here,
 * project not synced to the end, no lines of this BOQ in it, any read failure), in which case the caller loads the usual way.
 */
export async function loadBoqFromReplica(boqId: string, access: LocalAccess = {}): Promise<BoqScreenLoad | null> {
  if (!isLocalFirstEnabled()) return null;
  const header = readHint(boqId);
  if (!header) return null;
  try {
    const result = await loadLocalFirst<unknown>(BOQ_LINES_KIND, header.projectId, async () => [], access);
    if (result.state !== "local") return null;
    const mine = result.rows.filter(isGatewayLine).filter((l) => l.boqId === boqId);
    if (mine.length === 0) return null;
    const first = mine[0]!;
    // Title, version and status are the fields a person changes: taken from the rows. Lineage (parent, created) never changes.
    const boq: Boq = { ...header, title: first.boqTitle, version: first.boqVersion, status: first.boqStatus };
    return {
      boq,
      lines: orderLinesForBoq(mine).map(toBoqLineItemRow),
      source: "local-replica",
      copySavedAt: new Date(result.syncedAt ?? Date.now()).toISOString(),
      copyStatus: "off",
      indexedLines: 0,
    };
  } catch {
    return null;
  }
}

/** Pulls changes for this BOQ's project into the laptop's copy, in the background. Never throws, does nothing with the flag off. */
export async function revalidateBoq(
  boq: Pick<Boq, "projectId">,
  revalidate?: (ctx: { kind: string; projectId: string; userId: string }) => Promise<void>,
  userId?: string | null
): Promise<void> {
  if (!isLocalFirstEnabled()) return;
  try {
    let id = userId ?? null;
    if (!id) {
      const { createClient } = await import("@/lib/supabase/client");
      id = (await createClient().auth.getUser()).data.user?.id ?? null;
    }
    if (!id) return;
    const run = revalidate ?? (await import("./replica-shared")).revalidateViaSharedReplica;
    await run({ kind: BOQ_LINES_KIND, projectId: boq.projectId, userId: id });
  } catch {
    /* best effort */
  }
}
