/// <reference types="bun-types" />
// Catalogue integrity: every guide is complete, every in-app link is a real route, every message
// pattern is real (matches a harvested server message), and harvested messages are mapped.
import { describe, expect, test } from "bun:test";
import { SHIPPED_ROUTES } from "../../nav-routes";
import type { Guide, GuideContext } from "../types";
import { catalogue } from "./index";
import { matchGuide } from "../match";
import { ALL_GUIDES, CATALOGUE_MODULES } from "./all";
import { FIXTURES, genericOnly, guideMatchesMessage, mapFixtures } from "./coverage";

const CONTEXTS: GuideContext[] = [
  { route: "/scope/abc", search: "?projectId=p1", projectId: "p1", entityId: "abc" },
  { route: "/work-progress", search: "" },
];

function resolve(g: Guide, c: GuideContext): string {
  const to = g.fix!.to;
  return typeof to === "function" ? to(c) : to;
}

function isRealRoute(url: string): boolean {
  if (!url.startsWith("/")) return false;
  const path = url.split("?")[0]!.split("#")[0]!;
  const segs = path.split("/").filter(Boolean);
  return SHIPPED_ROUTES.some((pattern) => {
    const p = pattern.split("/").filter(Boolean);
    if (p.length !== segs.length) return false;
    return p.every((s, i) => s === segs[i] || (s.startsWith("[") && s.endsWith("]")));
  });
}

describe("error-guide catalogue", () => {
  test("is large enough and every module is non-empty", () => {
    expect(ALL_GUIDES.length).toBeGreaterThanOrEqual(150);
    for (const [name, list] of Object.entries(CATALOGUE_MODULES)) {
      expect(list.length, name).toBeGreaterThan(0);
    }
  });

  test("ids are unique", () => {
    const seen = new Set<string>();
    for (const g of ALL_GUIDES) {
      expect(seen.has(g.id), `duplicate id ${g.id}`).toBe(false);
      seen.add(g.id);
    }
  });

  test("every guide is complete, in plain words", () => {
    for (const g of ALL_GUIDES) {
      expect(g.title.trim().length, g.id).toBeGreaterThan(0);
      expect(g.title.trim().split(/\s+/).length, `${g.id} title longer than 8 words`).toBeLessThanOrEqual(8);
      expect(g.what.trim().length, g.id).toBeGreaterThan(0);
      expect(g.why.trim().length, g.id).toBeGreaterThan(0);
      expect(g.steps.length, `${g.id} steps`).toBeGreaterThanOrEqual(1);
      expect(g.steps.length, `${g.id} steps`).toBeLessThanOrEqual(4);
      for (const s of g.steps) expect(s.trim().length, `${g.id} empty step`).toBeGreaterThan(0);
      expect(["info", "warn", "block"]).toContain(g.severity);
      expect((g.returnLabel ?? "").trim().length, `${g.id} needs a returnLabel`).toBeGreaterThan(0);
      expect(Object.keys(g.match).length, `${g.id} has an empty match (the matcher ignores those)`).toBeGreaterThan(0);
    }
  });

  test("the user is told where to go: every blocking or warning guide with a fix has label + where", () => {
    for (const g of ALL_GUIDES) {
      if (!g.fix) continue;
      expect(g.fix.label.trim().length, g.id).toBeGreaterThan(0);
      expect(g.fix.where.trim().length, g.id).toBeGreaterThan(0);
    }
    // A blocking guide with no place to go would leave a person stuck.
    for (const g of ALL_GUIDES) {
      if (g.severity === "block") expect(g.fix, `${g.id} is blocking but has no fix`).toBeDefined();
    }
  });

  test("every fix.to resolves to a real route (no dead links), with and without a project", () => {
    for (const g of ALL_GUIDES) {
      if (!g.fix) continue;
      for (const c of CONTEXTS) {
        const url = resolve(g, c);
        expect(isRealRoute(url), `${g.id} -> ${url}`).toBe(true);
      }
    }
  });

  test("every messageRegex compiles and matches at least one harvested real message", () => {
    for (const g of ALL_GUIDES) {
      const r = g.match.messageRegex;
      if (!r) continue;
      const re = typeof r === "string" ? new RegExp(r, "i") : r;
      const hit = FIXTURES.some((f) => re.test(f.message));
      expect(hit, `${g.id}: ${re} matches no harvested message`).toBe(true);
    }
  });

  test("status on a regex guide agrees with at least one matching message's status", () => {
    for (const g of ALL_GUIDES) {
      if (!g.match.messageRegex || g.match.status === undefined) continue;
      const hit = FIXTURES.some((f) => guideMatchesMessage(g, f.message, f.status));
      expect(hit, `${g.id}: no message matches regex AND status`).toBe(true);
    }
  });

  test("combined catalogue (base + this) has unique ids", () => {
    const ids = catalogue.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the real matcher resolves most harvested messages to a specific guide, never the on-the-fly generic", () => {
    let generic = 0;
    for (const f of FIXTURES) {
      if (f.status === null) continue;
      const g = matchGuide({ route: "/scope", search: "", status: f.status, serverMessage: f.message }, catalogue);
      if (g.id.startsWith("generic-")) generic++;
    }
    expect(generic).toBe(0);
  });

  test("matcher compatibility: the framework needs EVERY key to match, so message guides carry no code or field", () => {
    for (const g of ALL_GUIDES) {
      if (typeof g.match.messageRegex === "undefined") continue;
      expect(g.match.code, `${g.id}: a code would stop a server-message guide matching`).toBeUndefined();
      expect(g.match.field, `${g.id}: a field would stop a server-message guide matching`).toBeUndefined();
      expect(typeof g.match.messageRegex, g.id).toBe("string");
    }
  });

  test("harvested messages are mapped (unmapped ones are listed in docs/ERROR_CATALOGUE.md)", () => {
    const { unmapped } = mapFixtures();
    // Ratchet: this number may go DOWN, never up. Anything new must get a guide.
    expect(unmapped.length).toBeLessThanOrEqual(UNMAPPED_CEILING);
    expect(genericOnly().length).toBeLessThanOrEqual(GENERIC_ONLY_CEILING);
  });
});

const UNMAPPED_CEILING = 0;
// Messages covered only by a general fallback (mostly "Failed to ..." 500s and bare "x is required").
// Ratchet: may go DOWN as specific guides are added, never up.
const GENERIC_ONLY_CEILING = 470;
