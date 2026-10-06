import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkApiWriteAccess, API_WRITE_POLICY, resolveWriteTier } from "./authz/api-write-policy";
import { ALL_ORG_ROLES } from "./authz/roles";
import { EDGE_EXTRA_ROUTES } from "../../scripts/vercel-route-inventory.mjs";
import { GENERATED_PATH, INVENTORY_PATH, lf, render, ROUTES_PATH, validateRoutes } from "../../scripts/projexa-api-edge.mjs";
import * as generated from "../../ai-os/audit37/projexa-api/policy.generated";
import { REQUESTS } from "./projexa-api-parity-cases";
import { isEdgeRoute, pxApiBase, pxApiFetch, PX_API_DEFAULT_BASE, PX_API_EDGE_URL, PX_EDGE_ORIGINS, PX_EDGE_EXTRA_ROUTES, PX_EDGE_ROUTES, PX_EDGE_SHADOWS } from "./px-api";

// AUDIT-100 A2: the Supabase Edge Function `projexa-api` (compliance-tracker supabase/functions/projexa-api) enforces THIS repo's role policy
// and answers only THIS repo's listed routes. Its table is generated here (scripts/projexa-api-edge.mjs) and copied byte for byte; these tests
// keep the generated file, the port of the decision functions, the route list, the parity contract's coverage and the browser switch equal.

type RoutesFile = { routes: { route: string; methods: Record<string, unknown> }[] };
const routesFile = (): RoutesFile => JSON.parse(readFileSync(ROUTES_PATH as string, "utf8"));
const inventory = () => JSON.parse(readFileSync(INVENTORY_PATH as string, "utf8"));

describe("the generated edge policy (AUDIT-100 A2)", () => {
  test("ai-os/audit37/projexa-api/policy.generated.ts is exactly what the sources give (regenerate: bun scripts/projexa-api-edge.mjs --write --ct <ct>)", () => {
    expect(lf(readFileSync(GENERATED_PATH as string, "utf8"))).toBe(render());
  });

  test("its SOURCE_SHA256 is the hash of its data (the same check compliance-tracker runs on its copy)", () => {
    expect(createHash("sha256").update(JSON.stringify(generated.sourceData())).digest("hex")).toBe(generated.SOURCE_SHA256);
  });

  test("the ported gate decides EXACTLY as src/lib/authz/api-write-policy.ts for every pattern, every method and every role", () => {
    const concrete = Object.keys(API_WRITE_POLICY).map((pattern) => "/api" + pattern.replace(/\[[^\]]+\]/g, "x1"));
    // the tier of every pattern, of a path under each (the nearest-ancestor fallback) and of unknown paths
    const all = ["/api", "/api/unknown", "/api/unknown/deeper/still", ...concrete, ...concrete.map((p) => p + "/extra"), ...concrete.map((p) => p + "/extra/more")];
    for (const path of all) expect(generated.resolveWriteTier(path), path).toBe(resolveWriteTier(path));
    // and the whole decision, every method x every role (+ none, + an unknown role), on every pattern
    let compared = 0;
    for (const path of concrete) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "patch"]) {
        for (const role of [...ALL_ORG_ROLES, null, "nonsense"]) {
          const want = checkApiWriteAccess(method, path, role).allowed;
          const got = generated.checkApiWriteAccess(method, path, role).allowed;
          if (want !== got) throw new Error(`${method} ${path} as ${role}: original ${want}, edge ${got}`);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(5_000);
  }, 120_000);

  test("CAN FAIL: a policy that lets client_viewer write a BOQ line is told apart from the real one", () => {
    const loose = generated.API_WRITE_POLICY.map(([p, t]) => [p, p === "/scope/line-items/[id]" ? "ANY_ROLE" : t] as const);
    const real = generated.API_WRITE_POLICY.find(([p]) => p === "/scope/line-items/[id]")![1];
    expect(real).toBe("PM_OR_ABOVE");
    expect(loose.find(([p]) => p === "/scope/line-items/[id]")![1]).not.toBe(real);
    expect(generated.checkApiWriteAccess("PATCH", "/api/scope/line-items/abc", "client_viewer").allowed).toBe(false);
  });
});

describe("the route list (deny by default: only these are answered by the edge)", () => {
  test("every listed route is a real veridian-proxy route of the inventory, with its real methods and a full upstream description", () => {
    expect(validateRoutes(routesFile(), inventory())).toEqual([]);
  });

  test("CAN FAIL: an own-logic route, a method the handler lacks, an unknown route and an unknown key are each refused", () => {
    const inv = inventory();
    const bad = {
      routes: [
        { route: "/api/local-first/client-error", methods: { POST: { upstream: "/x", fallback: "Failed x" } } },
        { route: "/api/exceptions", methods: { DELETE: { upstream: "/x", fallback: "Failed x" } } },
        { route: "/api/zz-nope", methods: { GET: { upstream: "/x", fallback: "Failed x" } } },
        { route: "/api/permits/:id", methods: { GET: { upstream: "/permits/{id}", fallback: "Failed x", forward_everything: true } } },
      ],
    };
    const problems = validateRoutes(bad, inv) as string[];
    expect(problems.some((p) => p.includes("client-error") && p.includes("own-logic"))).toBe(true);
    expect(problems.some((p) => p.includes("DELETE is not a method"))).toBe(true);
    expect(problems.some((p) => p.includes("/api/zz-nope: not a route"))).toBe(true);
    expect(problems.some((p) => p.includes("unknown key forward_everything"))).toBe(true);
  });

  test("the parity contract covers every route and method the edge answers (an uncovered route cannot be added)", () => {
    for (const r of routesFile().routes) for (const m of Object.keys(r.methods)) expect(REQUESTS.some((q) => q.route === r.route && q.method === m), `${m} ${r.route}`).toBe(true);
  });

  test("batch 5: the browser switch's shadow list is the generated one; a literal Vercel sibling of a dynamic edge route stays same-origin", () => {
    expect([...PX_EDGE_SHADOWS].sort()).toEqual([...generated.SHADOW_ROUTES].sort());
    expect(isEdgeRoute("GET", "/api/drawings/export?projectId=p-1")).toBe(false);
    expect(isEdgeRoute("GET", "/api/materials/master")).toBe(false);
    // batch 6: review-day moved to the edge itself; /api/work-progress/photos and /report are the new literal siblings of /api/work-progress/:id
    expect(isEdgeRoute("POST", "/api/timesheets/review-day")).toBe(true);
    expect(isEdgeRoute("GET", "/api/work-progress/report?projectId=p")).toBe(false);
    expect(isEdgeRoute("POST", "/api/work-progress/photos")).toBe(false);
    expect(isEdgeRoute("PATCH", "/api/work-progress/e-1")).toBe(true);
    // a literal edge route beats a dynamic edge route: POST /api/scope/categories/approve is /api/scope/categories/:id (no POST), not /api/scope/:id/approve
    expect(isEdgeRoute("POST", "/api/scope/categories/approve")).toBe(false);
    expect(isEdgeRoute("POST", "/api/scope/s-1/approve")).toBe(true);
    expect(isEdgeRoute("GET", "/api/drawings/d-1")).toBe(true);
    expect(isEdgeRoute("GET", "/api/materials/issues?projectId=p")).toBe(true);
    expect(isEdgeRoute("GET", "/api/materials/m-1")).toBe(true);
    // a literal edge route without the method is NOT answered as the dynamic one either (Next answers 405 for it)
    expect(isEdgeRoute("GET", "/api/leads/bulk-reassign")).toBe(false);
  });

  test("the browser switch's route list is the edge's route list", () => {
    const fromFile = Object.fromEntries(routesFile().routes.map((r) => [r.route, Object.keys(r.methods).sort()]));
    const fromSwitch = Object.fromEntries(Object.entries(PX_EDGE_ROUTES).map(([k, v]) => [k, [...v].sort()]));
    expect(fromSwitch).toEqual(fromFile);
    expect(generated.EDGE_ROUTES.map((r) => r.route).sort()).toEqual(Object.keys(fromFile).sort());
  });
});

describe("G-09: new-organisation provisioning is answered by the function too (src/lib/px-api.ts PX_EDGE_EXTRA_ROUTES)", () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => (seen.push({ url: String(url), init: init ?? {} }), new Response("{}"))) as typeof fetch;

  test("the extra routes equal the inventory script's list and are not proxies of the generated table", () => {
    expect(Object.keys(PX_EDGE_EXTRA_ROUTES).sort()).toEqual([...EDGE_EXTRA_ROUTES].sort());
    for (const r of Object.keys(PX_EDGE_EXTRA_ROUTES)) expect(PX_EDGE_ROUTES[r]).toBeUndefined();
  });

  test("provision (POST) and repair (GET, POST) are edge routes; nothing else under /api/org is", () => {
    expect(isEdgeRoute("POST", "/api/org/provision")).toBe(true);
    expect(isEdgeRoute("GET", "/api/org/provision")).toBe(false);
    expect(isEdgeRoute("GET", "/api/org/repair")).toBe(true);
    expect(isEdgeRoute("POST", "/api/org/repair")).toBe(true);
    expect(isEdgeRoute("DELETE", "/api/org/repair")).toBe(false);
    for (const p of ["/api/org/invites", "/api/org/invites/accept", "/api/org-members", "/api/organization"]) expect(isEdgeRoute("POST", p)).toBe(false);
  });

  test("the signed-in browser sends provision to the function with its bearer token and no cookie; the kill switch sends it same-origin", async () => {
    seen.length = 0;
    await pxApiFetch("/api/org/provision", { method: "POST", body: "{}" }, { fetchImpl, getAccessToken: async () => "tok-9", base: PX_API_EDGE_URL });
    expect(seen[0]!.url).toBe(`${PX_API_EDGE_URL}/api/org/provision`);
    expect(new Headers(seen[0]!.init.headers).get("authorization")).toBe("Bearer tok-9");
    expect(seen[0]!.init.credentials).toBe("omit");
    await pxApiFetch("/api/org/provision", { method: "POST", body: "{}" }, { fetchImpl, getAccessToken: async () => "tok-9", base: "" });
    expect(seen[1]!.url).toBe("/api/org/provision");
    await pxApiFetch("/api/org/provision", { method: "POST", body: "{}" }, { fetchImpl, getAccessToken: async () => null, base: PX_API_EDGE_URL });
    expect(seen[2]!.url).toBe("/api/org/provision"); // no token in the browser: same origin, as for every route
  });

  test("signup and login call it through viaPxApi, never a bare fetch", () => {
    for (const f of ["src/app/signup/page.tsx", "src/app/login/page.tsx"]) {
      const src = readFileSync(join(import.meta.dir, "..", "..", f), "utf8");
      expect(src).toContain('viaPxApi("/api/org/provision"');
      expect(src).not.toMatch(/fetch\("\/api\/org\/provision"/);
    }
  });
});

describe("the browser switch (src/lib/px-api.ts)", () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => (seen.push({ url: String(url), init: init ?? {} }), new Response("{}"))) as typeof fetch;
  const getAccessToken = async () => "tok-123";

  test("empty base (the default today, and the kill switch): every call stays same-origin with the cookie, untouched", async () => {
    seen.length = 0;
    await pxApiFetch("/api/exceptions?projectId=p", { credentials: "same-origin" }, { fetchImpl, getAccessToken, base: "" });
    expect(seen[0]!.url).toBe("/api/exceptions?projectId=p");
    expect(seen[0]!.init.credentials).toBe("same-origin");
    expect(new Headers(seen[0]!.init.headers).get("authorization")).toBeNull();
    expect(pxApiBase("", "https://projexa-ai.com")).toBe("");
  });

  test("phase 3 default: the edge function on the production origins only; an explicit base (or the kill switch \"\") always wins", () => {
    expect(PX_API_DEFAULT_BASE).toBe(PX_API_EDGE_URL);
    expect(pxApiBase(undefined, "https://projexa-ai.com")).toBe(PX_API_EDGE_URL);
    expect(pxApiBase(undefined, "https://www.projexa-ai.com")).toBe(PX_API_EDGE_URL);
    // a preview deployment, the e2e rig, local dev, a server render: same origin (the function's CORS would refuse them anyway)
    for (const origin of ["https://projexa-git-x.vercel.app", "http://localhost:3117", "http://localhost:3100", null]) expect(pxApiBase(undefined, origin)).toBe("");
    expect(pxApiBase("", "https://projexa-ai.com")).toBe("");
    expect(pxApiBase(" https://example.test/fn/ ", null)).toBe("https://example.test/fn");
    // the function answers exactly these origins (compliance-tracker supabase/functions/projexa-api/handler.ts ALLOWED_ORIGINS)
    expect([...PX_EDGE_ORIGINS].sort()).toEqual(["https://projexa-ai.com", "https://www.projexa-ai.com"]);
  });

  test("base set: a listed route goes to the function with the bearer token and NO cookie; an unlisted route or method stays same-origin", async () => {
    seen.length = 0;
    await pxApiFetch("/api/scope/line-items/li%201", { method: "PATCH", body: "{}", headers: { "Content-Type": "application/json" }, credentials: "same-origin" }, { fetchImpl, getAccessToken, base: PX_API_EDGE_URL });
    expect(seen[0]!.url).toBe(`${PX_API_EDGE_URL}/api/scope/line-items/li%201`);
    expect(seen[0]!.init.credentials).toBe("omit");
    const h = new Headers(seen[0]!.init.headers);
    expect(h.get("authorization")).toBe("Bearer tok-123");
    expect(h.get("content-type")).toBe("application/json");
    await pxApiFetch("/api/assistant", { method: "POST" }, { fetchImpl, getAccessToken, base: PX_API_EDGE_URL });
    await pxApiFetch("/api/dashboard/project/p1", { method: "DELETE" }, { fetchImpl, getAccessToken, base: PX_API_EDGE_URL });
    await pxApiFetch("https://storage.example/signed?x=1", {}, { fetchImpl, getAccessToken, base: PX_API_EDGE_URL });
    expect(seen.slice(1).map((s) => s.url)).toEqual(["/api/assistant", "/api/dashboard/project/p1", "https://storage.example/signed?x=1"]);
  });

  test("base set but no access token: same-origin (the cookie still works), never a call without credentials", async () => {
    seen.length = 0;
    await pxApiFetch("/api/exceptions?projectId=p", {}, { fetchImpl, getAccessToken: async () => null, base: PX_API_EDGE_URL });
    expect(seen[0]!.url).toBe("/api/exceptions?projectId=p");
  });

  test("isEdgeRoute matches the shell's real URLs", () => {
    expect(isEdgeRoute("GET", "/api/dashboard/project/abc")).toBe(true);
    expect(isEdgeRoute("GET", "/api/exceptions?projectId=x")).toBe(true);
    expect(isEdgeRoute("GET", "/api/reports/boq-analysis?projectId=x")).toBe(true);
    expect(isEdgeRoute("get", "/api/drawings/d1/document-url")).toBe(true);
    expect(isEdgeRoute("GET", "/api/dashboard/project")).toBe(false);
    expect(isEdgeRoute("POST", "/api/local-first/client-error")).toBe(false);
  });
});
