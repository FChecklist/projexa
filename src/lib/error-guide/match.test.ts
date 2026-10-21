/// <reference types="bun-types" />
// The matcher's three promises: the MOST SPECIFIC guide wins, a guide is ALWAYS returned (a generic one that shows the server's own words, offers
// Retry when retrying is honest and links back to where the person was), and the catalogue itself obeys the contract (short titles, 1-4 steps).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { genericGuide, guideScore, matchGuide, resetLoggedMisses, resolveGuide, setUnmatchedLogger, sourceOf } from "./match";
import { catalogue } from "./catalogue";
import type { Guide, GuideContext } from "./types";

const here = { route: "/permits/new", search: "?projectId=p1" };
const ctx = (over: Partial<GuideContext> = {}): GuideContext => ({ ...here, ...over });

let misses: GuideContext[] = [];
beforeEach(() => {
  misses = [];
  resetLoggedMisses();
  setUnmatchedLogger((c) => misses.push(c));
});
afterEach(() => setUnmatchedLogger());

describe("most specific match wins", () => {
  test("a 400 about a missing organisation beats the generic 400 validation guide", () => {
    expect(matchGuide(ctx({ status: 400, serverMessage: "No organization for this user" })).id).toBe("no-organisation");
    expect(matchGuide(ctx({ status: 400, serverMessage: "name is required" })).id).toBe("validation-generic");
  });

  test("a timed-out READ and a timed-out WRITE get different guides; an unknown method is treated as a write (it may have been saved)", () => {
    expect(matchGuide(ctx({ code: "TIMEOUT", status: 0, method: "GET" })).id).toBe("timeout-read");
    expect(matchGuide(ctx({ code: "TIMEOUT", status: 0, method: "POST" })).id).toBe("timeout-write");
    expect(matchGuide(ctx({ code: "TIMEOUT", status: 0 })).id).toBe("timeout-write");
  });

  test("status lists match any member; a status that is not listed does not match", () => {
    for (const status of [500, 502, 503, 504]) expect(matchGuide(ctx({ status })).id).toBe("server-error");
    expect(matchGuide(ctx({ status: 401 })).id).toBe("auth-expired");
    expect(matchGuide(ctx({ status: 403 })).id).toBe("permission-denied");
    expect(matchGuide(ctx({ status: 404 })).id).toBe("not-found");
    expect(matchGuide(ctx({ status: 429 })).id).toBe("rate-limit");
    expect(matchGuide(ctx({ status: 418 })).id).toBe("generic-unknown");
  });

  test("a guide with more matching keys outranks one with fewer, whatever the catalogue order", () => {
    const loose: Guide = { ...catalogue[0], id: "loose", match: { status: 500 } };
    const tight: Guide = { ...catalogue[0], id: "tight", match: { status: 500, apiPath: "/api/projects", method: "POST" } };
    const c = ctx({ status: 500, apiPath: "/api/projects", method: "post" });
    expect(matchGuide(c, [loose, tight]).id).toBe("tight");
    expect(matchGuide(c, [tight, loose]).id).toBe("tight");
    // ...and when the tighter one does not fit, the looser one still does.
    expect(matchGuide(ctx({ status: 500, apiPath: "/api/other", method: "POST" }), [tight, loose]).id).toBe("loose");
  });

  test("every key a guide names must match: a wrong field or a wrong path means no match", () => {
    const g: Guide = { ...catalogue[0], id: "g", match: { status: 400, field: "targetDate" } };
    expect(guideScore(g, ctx({ status: 400, field: "name" }))).toBeNull();
    expect(guideScore(g, ctx({ status: 400, field: "targetDate" }))).not.toBeNull();
  });

  test("a malformed messageRegex never throws and simply does not match", () => {
    const g: Guide = { ...catalogue[0], id: "bad", match: { messageRegex: "([" } };
    expect(guideScore(g, ctx({ serverMessage: "x" }))).toBeNull();
  });
});

describe("a guide is ALWAYS returned", () => {
  test("for every kind of status, code and message combination, with a title, steps, and a way back to where the person was", () => {
    const statuses = [undefined, 0, 200, 302, 400, 401, 402, 403, 404, 405, 408, 409, 410, 413, 415, 422, 429, 499, 500, 501, 502, 503, 504, 599];
    const codes = [undefined, "OFFLINE", "TIMEOUT", "NOT_SENT", "UNCONFIRMED", "RENDER", "SOMETHING_NEW"];
    const messages = [undefined, "", "boom"];
    for (const status of statuses) {
      for (const code of codes) {
        for (const serverMessage of messages) {
          const c = ctx({ status, code, serverMessage });
          const g = matchGuide(c);
          const r = resolveGuide(g, c);
          expect(r.title.length).toBeGreaterThan(0);
          expect(r.what.length).toBeGreaterThan(0);
          expect(r.steps.length).toBeGreaterThan(0);
          expect(r.steps.length).toBeLessThanOrEqual(4);
          // The fallback ALWAYS links back to where the person was; a catalogue guide decides for itself whether it has a place to send them.
          if (g.id.startsWith("generic-")) expect(r.fix).not.toBeNull();
          expect(r.what).not.toContain("{serverMessage}");
        }
      }
    }
  });

  test("the fallback shows the server's own words", () => {
    const c = ctx({ status: 418, serverMessage: "I am a teapot" });
    const r = resolveGuide(matchGuide(c), c);
    expect(r.guide.id).toBe("generic-unknown");
    expect(r.what).toContain("I am a teapot");
  });

  test("the fallback links back to where the person was (screen + query), and offers Retry only when retrying is honest", () => {
    const unknown = ctx({ status: 418 });
    expect(resolveGuide(matchGuide(unknown), unknown).fix?.href).toBe("/permits/new?projectId=p1");
    expect(genericGuide(ctx({ status: 418 })).retry).toBe(true); // unknown: try again
    expect(genericGuide(ctx({ status: 599 })).retry).toBe(true); // server
    expect(genericGuide(ctx({ status: 0 })).retry).toBe(true); // network
    expect(genericGuide(ctx({ status: 409 })).retry).toBe(false); // conflict: re-sending identical data fails identically
    expect(genericGuide(ctx({ status: 413 })).retry).toBe(false); // upload too large
  });

  test("the fallback is chosen per source", () => {
    expect(sourceOf(ctx({ status: 0 }))).toBe("network");
    expect(sourceOf(ctx({ code: "OFFLINE" }))).toBe("network");
    expect(sourceOf(ctx({ status: 401 }))).toBe("auth");
    expect(sourceOf(ctx({ status: 403 }))).toBe("permission");
    expect(sourceOf(ctx({ status: 409 }))).toBe("conflict");
    expect(sourceOf(ctx({ status: 413 }))).toBe("upload");
    expect(sourceOf(ctx({ status: 422 }))).toBe("validation");
    expect(sourceOf(ctx({ status: 503 }))).toBe("server");
    expect(sourceOf(ctx({}))).toBe("unknown");
  });

  test("a fallback is logged as 'unmatched' ONCE per distinct failure; a real match is not logged", () => {
    const c = ctx({ status: 418, apiPath: "/api/x", method: "POST", serverMessage: "teapot" });
    matchGuide(c);
    matchGuide(c);
    matchGuide(c);
    expect(misses.length).toBe(1);
    matchGuide(ctx({ status: 418, apiPath: "/api/y", method: "POST", serverMessage: "teapot" }));
    expect(misses.length).toBe(2);
    matchGuide(ctx({ status: 401 }));
    expect(misses.length).toBe(2);
  });

  test("a guide whose match is empty never swallows everything", () => {
    const catchAll: Guide = { ...catalogue[0], id: "catch-all", match: {} };
    expect(matchGuide(ctx({ status: 418 }), [catchAll]).id).toBe("generic-unknown");
  });
});

describe("resolveGuide", () => {
  test("fills {serverMessage}, says so plainly when the server gave none, and works out a function link", () => {
    const g = catalogue.find((x) => x.id === "validation-generic")!;
    const c = ctx({ status: 400, serverMessage: "name is required", field: "name" });
    const r = resolveGuide(g, c);
    expect(r.what).toContain("name is required");
    expect(r.fix?.href).toBe("/permits/new?projectId=p1&focus=name");
    expect(resolveGuide(g, ctx({ status: 400 })).what).toContain("No reason was given.");
  });

  test("a sign-in link carries the WHOLE current address, query included, so the person returns to exactly this screen", () => {
    const g = catalogue.find((x) => x.id === "auth-expired")!;
    const r = resolveGuide(g, ctx({ status: 401 }));
    expect(r.fix?.href).toBe(`/login?redirectTo=${encodeURIComponent("/permits/new?projectId=p1")}`);
  });

  test("the timed-out write says it may have been saved and links to the LIST (not the form), keeping the project", () => {
    const c = ctx({ code: "TIMEOUT", status: 0, method: "POST", projectId: "p1" });
    const r = resolveGuide(matchGuide(c), c);
    expect(r.guide.id).toBe("timeout-write");
    expect(r.what.toLowerCase()).toContain("may have been saved");
    expect(r.what.toLowerCase()).toContain("check the list");
    expect(r.fix?.href).toBe("/permits?projectId=p1");
  });
});

describe("the catalogue obeys the contract", () => {
  test("ids are unique; titles are 8 words or fewer; 1-4 steps; every guide names at least one match key", () => {
    const ids = new Set<string>();
    for (const g of catalogue) {
      expect(ids.has(g.id)).toBe(false);
      ids.add(g.id);
      expect(g.title.trim().split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(g.steps.length).toBeGreaterThanOrEqual(1);
      expect(g.steps.length).toBeLessThanOrEqual(4);
      expect(Object.keys(g.match).length).toBeGreaterThan(0);
      expect(g.what.length).toBeGreaterThan(0);
      expect(g.why.length).toBeGreaterThan(0);
    }
  });

  test("the base set is present: auth, offline, timeout, 5xx, 403, 404, 429, no organisation, validation", () => {
    const have = new Set(catalogue.map((g) => g.id));
    for (const id of ["auth-expired", "offline", "timeout-write", "server-error", "permission-denied", "not-found", "rate-limit", "no-organisation", "validation-generic"]) expect(have.has(id)).toBe(true);
  });

  test("the 403 guide names the role needed and who to ask", () => {
    const g = catalogue.find((x) => x.id === "permission-denied")!;
    const text = `${g.why} ${g.steps.join(" ")}`;
    expect(text).toContain("Project Manager");
    expect(text).toContain("Owner or an Admin");
  });
});
