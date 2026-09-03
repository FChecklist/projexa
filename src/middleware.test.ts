/// <reference types="bun-types" />
// R67 J-01 fix pass (audit R-246). Two behaviours of the real middleware
// function, exercised rather than grepped for.
//
// WHY THIS CAN RUN AT ALL: with no Supabase env vars, createServerClient()
// throws synchronously inside middleware.ts's own try/catch, which by design
// degrades to "logged out for this one request" (see that file's comment).
// Every branch below is on the logged-out path, so the whole function runs
// with no network and no database.
//
// WHAT IT PINS:
//   1. A cacheable public route never leaves middleware with a Set-Cookie on
//      it. withLocaleCookie() writes NEXT_LOCALE on any request that arrives
//      without one -- i.e. exactly the cold first visit the s-maxage header
//      was added for. A shared cache storing that response would replay one
//      visitor's locale cookie to the next, and Vercel refuses to cache a
//      Set-Cookie response at all, so the header would be inert on the one
//      request it exists for.
//   2. A Hindi visitor gets the Hindi document, by REWRITE (the URL stays
//      "/"), which is what keeps the marketing pages both static and
//      localised.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { STATIC_PUBLIC_ROUTES } from "./lib/public-page-cache";

const ORIGIN = "http://localhost:3100";

// Kept deliberately unroutable: nothing here should ever reach the network,
// and if a future change made it try, this fails fast instead of hanging.
const ENV_UNDER_TEST = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-not-a-real-credential",
} as const;

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV_UNDER_TEST)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

function rewriteTarget(response: Response): string | null {
  const header = response.headers.get("x-middleware-rewrite");
  return header ? new URL(header, ORIGIN).pathname : null;
}

describe("no cacheable public route carries a Set-Cookie", () => {
  for (const route of STATIC_PUBLIC_ROUTES) {
    test(`${route}, visited with no cookie at all`, async () => {
      const response = await middleware(request(route));
      expect(response.headers.get("set-cookie")).toBeNull();
    });
  }

  test("the same visit to a route that is NOT cacheable still gets the locale cookie", () => {
    // The control: proves the assertion above is about these routes and not
    // about locale detection having quietly stopped working everywhere.
    return middleware(request("/login")).then((response) => {
      expect(response.headers.get("set-cookie")).toContain("NEXT_LOCALE=");
    });
  });
});

describe("the marketing pages are served in the visitor's locale by rewrite", () => {
  test("a NEXT_LOCALE=hi cookie gets the Hindi landing document", async () => {
    const response = await middleware(request("/", { cookie: "NEXT_LOCALE=hi" }));
    expect(rewriteTarget(response)).toBe("/hi");
    expect(response.status).toBe(200); // a rewrite, not a 3xx redirect
    expect(response.headers.get("location")).toBeNull();
  });

  test("...and the Hindi /how-it-works document", async () => {
    const response = await middleware(request("/how-it-works", { cookie: "NEXT_LOCALE=hi" }));
    expect(rewriteTarget(response)).toBe("/hi/how-it-works");
  });

  test("a first-time visitor with a Hindi browser gets it too, with no cookie written", async () => {
    const response = await middleware(request("/", { "accept-language": "hi-IN,hi;q=0.9,en;q=0.8" }));
    expect(rewriteTarget(response)).toBe("/hi");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("an English visitor is left on the English document, unrewritten", async () => {
    const response = await middleware(request("/", { "accept-language": "en-GB,en;q=0.9" }));
    expect(rewriteTarget(response)).toBeNull();
  });

  test("a locale this app has no messages for falls back to English, not a 404", async () => {
    const response = await middleware(request("/", { cookie: "NEXT_LOCALE=fr" }));
    expect(rewriteTarget(response)).toBeNull();
  });

  test("the Hindi document itself is served directly, not rewritten again", async () => {
    const response = await middleware(request("/hi", { cookie: "NEXT_LOCALE=hi" }));
    expect(rewriteTarget(response)).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("no other route is rewritten by locale", async () => {
    for (const path of ["/login", "/signup", "/dashboard"]) {
      const response = await middleware(request(path, { cookie: "NEXT_LOCALE=hi" }));
      expect(`${path}: ${rewriteTarget(response)}`).toBe(`${path}: null`);
    }
  });
});

describe("the logged-out page gate still works", () => {
  test("a protected page redirects to /login with the destination preserved", async () => {
    const response = await middleware(request("/dashboard"));
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    const url = new URL(location!, ORIGIN);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirectTo")).toBe("/dashboard");
  });

  test("both marketing landing documents stay reachable logged out", async () => {
    for (const route of ["/", "/hi", "/how-it-works", "/hi/how-it-works"]) {
      const response = await middleware(request(route, { "accept-language": "en" }));
      expect(`${route}: ${response.headers.get("location")}`).toBe(`${route}: null`);
    }
  });
});
