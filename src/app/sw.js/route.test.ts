/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { GET } from "./route";

describe("GET /sw.js", () => {
  test("serves the generated worker as JavaScript, never cached by the browser's HTTP cache", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const script = await response.text();
    expect(() => new Function(script)).not.toThrow(); // it parses
  });

  test("is stamped per deploy, wires the four worker events, and carries the page gate's own public lists", async () => {
    const script = await (await GET()).text();
    expect(script).toContain("PROJEXA service worker");
    for (const event of ["install", "activate", "fetch", "message"]) expect(script).toContain(`self.addEventListener("${event}"`);
    expect(script).toContain('"/login"'); // from PUBLIC_PAGE_PATHS: the worker and the middleware agree which pages need a session
    expect(script).toContain('"/local"');
    expect(script).toContain('"projexa-shell-"'); // earlier generations' caches are cleaned on activate
  });
});
