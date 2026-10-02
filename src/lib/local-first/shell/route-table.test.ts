import { describe, expect, test } from "bun:test";
import { SHELL_ROUTES, findShellRoute, navRoutes } from "./route-table";
import { defineShellRoute } from "./types";

describe("the route table", () => {
  test("the BOQ module is registered: the list and the object screen, with the object route carrying an :id", () => {
    expect(SHELL_ROUTES.map((r) => r.pattern)).toEqual(["/scope", "/scope/:id"]);
    expect(findShellRoute("/scope")!.route.title).toBe("Scope of Work (BOQ)");
    const object = findShellRoute("/scope/abc-123");
    expect(object!.route.pattern).toBe("/scope/:id");
    expect(object!.params).toEqual({ id: "abc-123" });
  });

  test("a path the shell has no screen for is not matched (the shell falls back to the server's page)", () => {
    for (const path of ["/rfis", "/dashboard", "/scope/abc/extra", "/", "/scope-of-work"]) expect(findShellRoute(path)).toBeNull();
  });

  test("every route can load its screen: a function component is the default export", async () => {
    for (const route of SHELL_ROUTES) {
      const mod = await route.load();
      expect(typeof mod.default).toBe("function");
    }
  });

  test("only parameterless routes with a nav entry are links in the header, in order", () => {
    expect(navRoutes()).toEqual([{ href: "/scope", label: "Scope (BOQ)" }]);
    const routes = [
      defineShellRoute({ pattern: "/b", title: "B", nav: { label: "B", order: 20 }, load: async () => ({ default: () => null }) }),
      defineShellRoute({ pattern: "/a", title: "A", nav: { label: "A", order: 10 }, load: async () => ({ default: () => null }) }),
      defineShellRoute({ pattern: "/a/:id", title: "A one", nav: { label: "never", order: 1 }, load: async () => ({ default: () => null }) }),
      defineShellRoute({ pattern: "/hidden", title: "H", load: async () => ({ default: () => null }) }),
    ];
    expect(navRoutes(routes)).toEqual([{ href: "/a", label: "A" }, { href: "/b", label: "B" }]);
  });

  test("adding a module is ONE entry: it is matched, loaded and linked with no other change", async () => {
    const extra = defineShellRoute<{ n: number }>({
      pattern: "/rfis/:id",
      title: "RFI",
      load: async () => ({ default: () => null }),
      adapter: async (_shell, params) => ({ n: Number(params.id) }),
    });
    const routes = [...SHELL_ROUTES, extra];
    const hit = findShellRoute("/rfis/42", routes)!;
    expect(hit.params).toEqual({ id: "42" });
    expect(await hit.route.adapter!({} as never, hit.params, new URLSearchParams())).toEqual({ n: 42 });
  });
});
