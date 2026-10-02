import { describe, expect, test } from "bun:test";
import { SERVER_PAGE_PARAM, isShellNavigable, matchPattern, matchRoute, parseShellLocation, serverPageUrl } from "./paths";

describe("shell locations", () => {
  test("the /local prefix and the plain app path are the same screen", () => {
    expect(parseShellLocation("/local")).toEqual({ path: "/", search: "" });
    expect(parseShellLocation("/local/")).toEqual({ path: "/", search: "" });
    expect(parseShellLocation("/local/scope/abc", "?projectId=p1")).toEqual({ path: "/scope/abc", search: "?projectId=p1" });
    expect(parseShellLocation("/scope/abc", "projectId=p1")).toEqual({ path: "/scope/abc", search: "?projectId=p1" });
    expect(parseShellLocation("/scope/", "?")).toEqual({ path: "/scope", search: "" });
    expect(parseShellLocation("//scope///abc")).toEqual({ path: "/scope/abc", search: "" });
    expect(parseShellLocation("/localx/y")).toEqual({ path: "/localx/y", search: "" }); // only the exact prefix is stripped
  });

  test("the server fallback is the same screen with the marker that tells the worker not to serve the shell first", () => {
    const url = serverPageUrl({ path: "/rfis/42", search: "?projectId=p1" });
    const parsed = new URL(url, "https://px.test");
    expect(parsed.pathname).toBe("/rfis/42");
    expect(parsed.searchParams.get("projectId")).toBe("p1");
    expect(parsed.searchParams.get(SERVER_PAGE_PARAM)).toBe("1");
    expect(serverPageUrl({ path: "/", search: "" })).toBe(`/dashboard?${SERVER_PAGE_PARAM}=1`);
  });

  test("which links the shell handles itself", () => {
    const origin = "https://px.test";
    expect(isShellNavigable("/scope/abc", origin)).toBe(true);
    expect(isShellNavigable("https://px.test/scope?x=1", origin)).toBe(true);
    expect(isShellNavigable("https://elsewhere.test/scope", origin)).toBe(false);
    expect(isShellNavigable("/api/projects", origin)).toBe(false);
    expect(isShellNavigable("/logo-mark.svg", origin)).toBe(false);
    expect(isShellNavigable("/_release/px-1.tar.gz", origin)).toBe(false);
    expect(isShellNavigable("http://[bad", origin)).toBe(false);
  });
});

describe("route matching", () => {
  test("literal and :param segments", () => {
    expect(matchPattern("/scope", "/scope")).toEqual({});
    expect(matchPattern("/scope/:id", "/scope/abc-123")).toEqual({ id: "abc-123" });
    expect(matchPattern("/scope/:id", "/scope/a%20b")).toEqual({ id: "a b" });
    expect(matchPattern("/scope/:id", "/scope")).toBeNull();
    expect(matchPattern("/scope", "/scope/abc")).toBeNull();
    expect(matchPattern("/scope/:id", "/rfis/abc")).toBeNull();
    expect(matchPattern("/scope/:id", "/scope/%E0%A4%A")).toBeNull(); // a broken escape is no match, not a crash
    expect(matchPattern("/", "/")).toEqual({});
  });

  test("a literal route wins over a parameter route regardless of order", () => {
    const routes = [{ pattern: "/scope/:id", name: "object" }, { pattern: "/scope/new", name: "create" }];
    expect(matchRoute(routes, "/scope/new")!.route.name).toBe("create");
    expect(matchRoute(routes, "/scope/abc")!.route.name).toBe("object");
    expect(matchRoute(routes, "/nothing")).toBeNull();
  });
});
