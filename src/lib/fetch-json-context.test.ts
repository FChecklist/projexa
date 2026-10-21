/// <reference types="bun-types" />
// fetchJson must hand the guided-error matcher the FULL context: status, the server's code, the call (method + path), on a refusal AND when the
// request never got an answer -- and the same guide must come out of it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

function setLocation(path: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`http://localhost:3000${path}`);
}


import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError, fetchJson } from "./fetch-json";
import { contextFromError } from "./error-guide/context";
import { matchGuide, setUnmatchedLogger } from "./error-guide/match";
import { listTrail, pushReturn } from "./error-guide/return-trail";

const realFetch = globalThis.fetch;
beforeEach(() => {
  sessionStorage.clear();
  setUnmatchedLogger(() => {});
  setLocation("/permits/new?projectId=p1");
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setUnmatchedLogger();
});

const json = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

describe("fetchJson attaches the facts a guide needs", () => {
  test("a refusal carries status, the server's code, the method and the path (query stripped)", async () => {
    globalThis.fetch = json(400, { error: "name is required", code: "NAME_REQUIRED", field: "name" });
    const err = (await caught(fetchJson("/api/projects?x=1", { method: "post" }))) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("NAME_REQUIRED");
    expect(err.method).toBe("POST");
    expect(err.apiPath).toBe("/api/projects");
    expect(err.message).toBe("name is required");
    const ctx = contextFromError(err);
    expect(ctx).toMatchObject({ status: 400, code: "NAME_REQUIRED", method: "POST", apiPath: "/api/projects", field: "name", route: "/permits/new", projectId: "p1", serverMessage: "name is required" });
    expect(matchGuide(ctx).id).toBe("validation-generic");
  });

  test("a body without a code leaves code undefined; the message is still the server's own words", async () => {
    globalThis.fetch = json(502, null);
    const err = (await caught(fetchJson("/api/projects"))) as ApiError;
    expect(err.code).toBeUndefined();
    expect(err.method).toBe("GET");
    expect(matchGuide(contextFromError(err)).id).toBe("server-error");
  });

  test("an unreachable network keeps its TypeError (callers still see what they saw) with OFFLINE + the call attached", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const err = (await caught(fetchJson("/api/projects", { method: "POST" }))) as TypeError & { code?: string; apiPath?: string; method?: string };
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("OFFLINE");
    expect(err.apiPath).toBe("/api/projects");
    expect(err.method).toBe("POST");
    const ctx = contextFromError(err);
    expect(ctx.status).toBe(0);
    expect(matchGuide(ctx).id).toBe("offline");
  });

  test("a timeout (AbortError/TimeoutError) is TIMEOUT and, for a write, 'it may have been saved'", async () => {
    globalThis.fetch = (async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    }) as typeof fetch;
    const err = await caught(fetchJson("/api/permits", { method: "POST" }));
    expect(matchGuide(contextFromError(err)).id).toBe("timeout-write");
  });

  test("a successful WRITE tells the return trail something was saved on this screen; a read does not", async () => {
    setLocation("/finance/currencies");
    pushReturn({ returnUrl: "/permits/new", label: "your permit", destination: "/finance/currencies" });
    globalThis.fetch = json(200, { ok: true });
    await fetchJson("/api/finance/currencies");
    expect(listTrail()[0].ready).toBeUndefined();
    await fetchJson("/api/finance/currencies", { method: "POST" });
    expect(listTrail()[0].ready).toBe(true);
  });
});
