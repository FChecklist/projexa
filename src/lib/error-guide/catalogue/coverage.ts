// Shared by the integrity test and scripts/gen-error-catalogue-doc.ts: which harvested real server
// messages are covered by which guide. This mirrors the framework matcher for the one dimension a
// harvested fixture has (message text + HTTP status); guides that match only on code / field /
// apiPath (raised by the screens themselves) are not counted here.
import type { Guide } from "../types";
import { ALL_GUIDES, CATALOGUE_MODULES } from "./all";
import { baseGuides } from "./base";
import fixtures from "./harvested-messages.json";

export type Fixture = { message: string; status: number | null; where: string[] };
export const FIXTURES = fixtures as Fixture[];

const toRegex = (r: RegExp | string): RegExp => (typeof r === "string" ? new RegExp(r, "i") : r);

export function guideMatchesMessage(g: Guide, message: string, status: number | null): boolean {
  const m = g.match;
  const statuses = m.status === undefined ? null : Array.isArray(m.status) ? m.status : [m.status];
  if (statuses && status !== null && !statuses.includes(status)) return false;
  if (m.messageRegex) return toRegex(m.messageRegex).test(message);
  // No regex: only a status-only guide is a message-level fallback.
  const statusOnly = statuses !== null && !m.code && !m.apiPath && !m.method && !m.field;
  return statusOnly && status !== null;
}

const BASE_FALLBACK_STATUSES: Guide[] = baseGuides;

export function mapFixtures(guides: Guide[] = [...ALL_GUIDES, ...BASE_FALLBACK_STATUSES]): { mapped: Map<string, string[]>; unmapped: Fixture[] } {
  const mapped = new Map<string, string[]>();
  const unmapped: Fixture[] = [];
  for (const f of FIXTURES) {
    const hits = guides.filter((g) => guideMatchesMessage(g, f.message, f.status)).map((g) => g.id);
    if (hits.length) mapped.set(f.message, hits);
    else unmapped.push(f);
  }
  return { mapped, unmapped };
}

/** Harvested messages that only a general fallback guide (network.ts) covers -- they get safe,
 *  correct generic advice but no screen-specific wording yet. Listed in docs/ERROR_CATALOGUE.md. */
export function genericOnly(guides: Guide[] = [...ALL_GUIDES, ...BASE_FALLBACK_STATUSES]): Fixture[] {
  const generic = new Set([...CATALOGUE_MODULES["Network and general"]!.map((g) => g.id), ...BASE_FALLBACK_STATUSES.map((g) => g.id)]);
  const { mapped } = mapFixtures(guides);
  return FIXTURES.filter((f) => {
    const ids = mapped.get(f.message);
    return !!ids && ids.every((i) => generic.has(i));
  });
}
