import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchEdgeRoute, pxApiFetch, PX_API_EDGE_URL, PX_EDGE_REVALIDATE, PX_REVALIDATABLE, revalidateAfterEdgeWrite } from "./px-api";
import type { Outcome, ParityCase } from "./projexa-api-parity-cases";

// AUDIT-100 A2 batch 7: the page-side cache entries a write clears. The Next write handlers call revalidateTag / revalidatePath; a function on Supabase
// cannot, so the browser asks Vercel's /api/cache/revalidate after the edge answered. This file proves (1) the list the browser clears is exactly what the
// REAL Next handlers cleared in the recorded parity contract, in both directions, and (2) the browser's side of it.

type Golden = { cases: { case: ParityCase; expect: Outcome }[] };
const golden = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "ai-os", "audit37", "projexa-api", "parity.golden.json"), "utf8")) as Golden;
const routesFile = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "ai-os", "audit37", "projexa-api-routes.json"), "utf8")) as { routes: { route: string; methods: Record<string, { revalidate?: { tags: string[]; paths?: string[]; when?: string } }> }[] };

const keys = new WeakMap<object, string | null>();
const keyOf = (c: ParityCase) => {
  if (!keys.has(c)) {
    const route = matchEdgeRoute(c.method, c.path.split("?")[0]!);
    keys.set(c, route ? `${c.method} ${route}` : null);
  }
  return keys.get(c)!;
};

describe("what a write clears is recorded from the real Next handlers", () => {
  test("projexa-api-routes.json `revalidate` is the browser's table, entry for entry", () => {
    const fromFile: Record<string, unknown> = {};
    for (const r of routesFile.routes) for (const [m, spec] of Object.entries(r.methods)) if (spec.revalidate) fromFile[`${m} ${r.route}`] = spec.revalidate;
    expect(fromFile).toEqual(Object.fromEntries(Object.entries(PX_EDGE_REVALIDATE)));
    expect(Object.keys(fromFile).length).toBe(12);
  });

  test("every answer of a real Next handler that cleared something belongs to a listed write, and clears exactly the listed entries", () => {
    let cleared = 0;
    for (const { case: c, expect: e } of golden.cases) {
      if (!e.revalidated) continue;
      cleared++;
      const rule = PX_EDGE_REVALIDATE[keyOf(c) ?? ""];
      expect(rule, `${c.name} cleared ${JSON.stringify(e.revalidated)} but is not in PX_EDGE_REVALIDATE`).toBeDefined();
      expect(e.revalidated, c.name).toEqual({ tags: [...rule!.tags], paths: [...(rule!.paths ?? [])] });
    }
    expect(cleared).toBeGreaterThan(100);
  });

  test("every listed write DID clear its entries in the recorded contract when it succeeded, and (when \"success\") never when it did not", () => {
    for (const [key, rule] of Object.entries(PX_EDGE_REVALIDATE)) {
      const mine = golden.cases.filter((g) => keyOf(g.case) === key && g.case.who !== "signed_out");
      expect(mine.length, key).toBeGreaterThan(5);
      const okCases = mine.filter((g) => g.expect.status >= 200 && g.expect.status < 300);
      expect(okCases.length, `${key}: no successful recorded case`).toBeGreaterThan(0);
      for (const g of okCases) expect(g.expect.revalidated, g.case.name).toEqual({ tags: [...rule.tags], paths: [...(rule.paths ?? [])] });
      if ((rule.when ?? "success") === "success") for (const g of mine.filter((x) => x.expect.status < 200 || x.expect.status >= 300)) expect(g.expect.revalidated, g.case.name).toBeUndefined();
    }
  });

  test("\"always\" is real: POST /api/projects clears BEFORE it calls the backend, so even a refused create cleared the list (the browser does the same)", () => {
    const failed = golden.cases.filter((g) => keyOf(g.case) === "POST /api/projects" && g.expect.status >= 400 && g.expect.revalidated);
    expect(failed.length).toBeGreaterThan(0);
    expect(PX_EDGE_REVALIDATE["POST /api/projects"]!.when).toBe("always");
    for (const [key, rule] of Object.entries(PX_EDGE_REVALIDATE)) if (key !== "POST /api/projects") expect(rule.when, key).toBeUndefined();
  });

  test("the route clears only what a listed write clears", () => {
    expect([...PX_REVALIDATABLE.tags].sort()).toEqual(["knowledge-base", "module:documents", "module:drawings", "module:manpower", "module:materials", "module:meetings", "module:moms", "module:mood-boards", "module:permits", "module:scope", "projects"]);
    expect([...PX_REVALIDATABLE.paths]).toEqual(["/scope"]);
  });
});

describe("the browser clears them after the edge answered a write", () => {
  const edgeFetch = (status: number) => (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return String(url).startsWith(PX_API_EDGE_URL) ? new Response("{}", { status }) : new Response("{}", { status: 200 });
  }) as typeof fetch;
  const seen: { url: string; init: RequestInit }[] = [];
  const base = { base: PX_API_EDGE_URL, getAccessToken: async () => "tok" };
  const pings = () => seen.filter((s) => s.url === "/api/cache/revalidate");

  test("a successful write: the edge call first, then ONE same-origin call with the cookie that names the entries; the caller's answer is the edge's", async () => {
    seen.length = 0;
    const res = await pxApiFetch("/api/permits", { method: "POST", body: new FormData() }, { ...base, fetchImpl: edgeFetch(201) });
    expect(res.status).toBe(201);
    expect(seen[0]!.url).toBe(`${PX_API_EDGE_URL}/api/permits`);
    expect(pings().length).toBe(1);
    const ping = pings()[0]!;
    expect(ping.init.method).toBe("POST");
    expect(ping.init.credentials).toBe("same-origin");
    expect(JSON.parse(String(ping.init.body))).toEqual({ tags: ["module:permits"], paths: [] });
  });

  test("a BOQ create names its page too; a knowledge-base edit names the dynamic route's tag", async () => {
    seen.length = 0;
    await pxApiFetch("/api/scope", { method: "POST", body: "{}" }, { ...base, fetchImpl: edgeFetch(201) });
    await pxApiFetch("/api/knowledge-base/kb%201", { method: "PATCH", body: "{}" }, { ...base, fetchImpl: edgeFetch(200) });
    expect(pings().map((p) => JSON.parse(String(p.init.body)))).toEqual([{ tags: ["module:scope"], paths: ["/scope"] }, { tags: ["knowledge-base"], paths: [] }]);
  });

  test("a write the edge refused clears nothing (the Next handler clears after the backend accepted), except /api/projects, which clears first", async () => {
    seen.length = 0;
    for (const [path, status] of [["/api/documents", 403], ["/api/meetings", 409], ["/api/labour-roster", 500]] as const) await pxApiFetch(path, { method: "POST", body: "{}" }, { ...base, fetchImpl: edgeFetch(status) });
    expect(pings().length).toBe(0);
    await pxApiFetch("/api/projects", { method: "POST", body: "{}" }, { ...base, fetchImpl: edgeFetch(409) });
    expect(pings().length).toBe(1);
  });

  test("reads, writes without a rule, same-origin calls (kill switch / no token) and a signed-out person never ping", async () => {
    seen.length = 0;
    await pxApiFetch("/api/permits?all=true", {}, { ...base, fetchImpl: edgeFetch(200) });
    await pxApiFetch("/api/vendors", { method: "POST", body: "{}" }, { ...base, fetchImpl: edgeFetch(201) });
    await pxApiFetch("/api/permits", { method: "POST", body: "{}" }, { base: "", getAccessToken: async () => "tok", fetchImpl: edgeFetch(201) });
    await pxApiFetch("/api/permits", { method: "POST", body: "{}" }, { base: PX_API_EDGE_URL, getAccessToken: async () => null, fetchImpl: edgeFetch(201) });
    expect(pings().length).toBe(0);
  });

  test("a ping that fails, or hangs, never fails the write: the caller still gets the edge's answer, within the wait budget", async () => {
    const failing = (async (url: RequestInfo | URL) => {
      if (String(url) === "/api/cache/revalidate") throw new TypeError("network down");
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    expect((await pxApiFetch("/api/mood-boards", { method: "POST", body: "{}" }, { ...base, fetchImpl: failing })).status).toBe(201);
    const hanging = (async (url: RequestInfo | URL) => (String(url) === "/api/cache/revalidate" ? new Promise<Response>(() => {}) : new Response("{}", { status: 201 }))) as typeof fetch;
    const t0 = Date.now();
    const res = await pxApiFetch("/api/mood-boards", { method: "POST", body: "{}" }, { ...base, fetchImpl: hanging, revalidateWaitMs: 60 });
    expect(res.status).toBe(201);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  test("revalidateAfterEdgeWrite alone: no rule, no call", async () => {
    seen.length = 0;
    await revalidateAfterEdgeWrite("POST", "/api/vendors", new Response("{}"), edgeFetch(200));
    expect(seen.length).toBe(0);
  });
});
