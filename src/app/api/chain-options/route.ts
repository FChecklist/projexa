import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import {
  boqLineLevel,
  levelSourceFor,
  normaliseLevel,
  parseLevelPath,
  rosterLevel,
  type BoqRow,
  type RosterEntry,
} from "@/lib/chain-options";

// R67 WS-C (C-04) -- WHAT BAND 2 ASKS NEXT.
//
// GET /api/chain-options?projectId=<id>&path=work_progress,record_progress
//   -> { legend, kind, options: [{ id, label, isLeaf?, unavailableReason? }],
//        emptyPrompt?: { text, actionLabel?, route? } }
//
// It is a SERVER route, not a browser fetch to VERIDIAN, for decision D-04's
// reason: the org API key stays here. The browser never learns it.
//
// WHERE THE RESOLUTION HAPPENS, HONESTLY. C-04's design names
// GET /api/v1/projexa/chain-options on VERIDIAN as the source. That endpoint
// is WS-B's and does not exist on this branch's base -- so this route
// resolves the same levels from the endpoints PROJEXA already proxies
// (/scope for a project's BOQ) and returns EXACTLY the shape above.
// src/lib/chain-options.ts's normaliseLevel() guards that shape here, so when
// WS-B's endpoint ships this handler swaps one fetch for another and the
// contract is still checked in one place.
//
// AN UNKNOWN LEVEL IS A 404 WITH WORDS, NOT AN EMPTY LIST. "there is nothing
// to choose here" and "I do not know what you asked for" are different
// answers, and rendering the second as the first is the silent-empty-state
// defect this programme exists to remove.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(req.url);
  const path = parseLevelPath(searchParams.get("path"));
  const projectId = searchParams.get("projectId");

  if (path.length === 0) {
    return NextResponse.json({ error: "path query param is required" }, { status: 400 });
  }

  const source = levelSourceFor(path, projectId);
  if (!source) {
    return NextResponse.json(
      {
        error: projectId
          ? "There are no options for that step yet"
          : "Pick a project before choosing a line",
      },
      { status: 404 }
    );
  }

  if (source.kind === "static") {
    return NextResponse.json(normaliseLevel(source.level));
  }

  if (source.kind === "roster") {
    // R67 C-08. Same rule as the BOQ read below: a failed roster read is an
    // ERROR, never an empty chip grid that would say "this project has no
    // workers" about a project with twelve.
    try {
      const data = await callVeridian<RosterEntry[] | { roster?: RosterEntry[] }>(
        `/construction/labour-roster?projectId=${encodeURIComponent(source.projectId)}`,
        { organizationId: ctx.organizationId!, root: true }
      );
      const roster: RosterEntry[] = Array.isArray(data) ? data : (data?.roster ?? []);
      const level = normaliseLevel(rosterLevel(roster));
      if (!level) return NextResponse.json({ error: "Couldn't build that step" }, { status: 502 });
      return NextResponse.json(level);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof VeridianApiError ? err.message : "Couldn't load this project's roster" },
        { status: err instanceof VeridianApiError ? err.status : 502 }
      );
    }
  }

  try {
    const data = await callVeridian<BoqRow[] | { boqs?: BoqRow[] }>(
      `/scope?projectId=${encodeURIComponent(source.projectId)}`,
      { organizationId: ctx.organizationId! }
    );
    const boqs: BoqRow[] = Array.isArray(data) ? data : (data?.boqs ?? []);
    const level = normaliseLevel(boqLineLevel(boqs));
    if (!level) {
      // Unreachable with the builder above; if it ever is reached, the panel
      // must show an error rather than an empty chip row.
      return NextResponse.json({ error: "Couldn't build that step" }, { status: 502 });
    }
    return NextResponse.json(level);
  } catch (err) {
    // The backend's OWN words. An empty list rendered in place of an error is
    // how a broken read becomes "this project has no BOQ".
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Couldn't load this project's BOQ" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
