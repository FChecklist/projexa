/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (AW-405). The typed calls of the AI work link screens, against a fake Fetch and a fake session. Every request
// shape of mint.ts (compliance-tracker supabase/functions/ai-work-link) is pinned here, plus the two promises the screens depend on:
//   * SESSION_STALE refreshes the session and sends the request once more, once, and no more;
//   * a minted token reaches the caller and nothing else: not a URL, not storage, not a console line, not an error message.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { AWL_URL, AwlError, createAwlClient, type AwlSession } from "./ai-work-link-client";

const TOKEN = `pxa_${"ab12".repeat(16)}`;
const LINK = `${AWL_URL}/${TOKEN}`;

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

/** A fake Fetch that answers from a queue and remembers every call. */
function fakeFetch(...answers: Array<{ status: number; body: unknown } | "throw">) {
  const calls: Call[] = [];
  const queue = [...answers];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init as Call["init"] });
    const next = queue.shift();
    if (next === undefined) throw new Error("the fake fetch ran out of answers");
    if (next === "throw") throw new TypeError("network down");
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function session(first: string | null = "T-first", refreshed: string | null = "T-fresh") {
  const seen = { accessToken: 0, refresh: 0 };
  const s: AwlSession = {
    accessToken: async () => {
      seen.accessToken += 1;
      return first;
    },
    refresh: async () => {
      seen.refresh += 1;
      return refreshed;
    },
  };
  return { s, seen };
}

const MINTED = {
  link_id: "lnk_1",
  level: 0,
  allowed_functions: ["a"],
  hide_personal: true,
  label: "my assistant",
  expires_at: "2026-10-03T10:00:00Z",
  project: { id: "p1", name: "Tower A" },
  token: TOKEN,
  links: { link: LINK, header_base: `${AWL_URL}/header`, inbox: null },
  notice: "This is the only time the link is shown. Copy it now and paste it into an assistant that only you use.",
};

describe("the address", () => {
  test("is the live ai-work-link function of the VERIDIAN project", () => {
    expect(AWL_URL).toBe("https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link");
  });
});

describe("request shapes", () => {
  test("warning: GET /warning?project=&level= with the session token, no body, no cookie", async () => {
    const f = fakeFetch({ status: 200, body: { project: { id: "p 1", name: "Tower A" }, lines: 12, tasks: 3, people: 4, money_visible: true, level: 1, can_record: false, writes_enabled: false, rank: 2, max_level: 1, functions: [], sentence: "The true sentence." } });
    const client = createAwlClient({ session: session().s, fetch: f.fn });
    const w = await client.warning("p 1", 1);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(`${AWL_URL}/warning?project=p%201&level=1`);
    expect(f.calls[0].init.method).toBe("GET");
    expect(f.calls[0].init.headers.Authorization).toBe("Bearer T-first");
    expect(f.calls[0].init.body).toBeUndefined();
    expect(f.calls[0].init.credentials).toBe("omit");
    expect(f.calls[0].init.cache).toBe("no-store");
    expect(f.calls[0].init.referrerPolicy).toBe("no-referrer");
    expect(w).toMatchObject({ projectName: "Tower A", sentence: "The true sentence.", level: 1, lines: 12, tasks: 3, people: 4, moneyVisible: true, writesEnabled: false, maxLevel: 1 });
  });

  test("warning: an answer with no sentence is refused, never shown as an empty warning", async () => {
    const f = fakeFetch({ status: 200, body: { project: { id: "p1", name: "Tower A" }, sentence: "  " } });
    await expect(createAwlClient({ session: session().s, fetch: f.fn }).warning("p1", 0)).rejects.toMatchObject({ code: "BAD_ANSWER" });
  });

  test("mint: POST /mint with exactly projectId, level, days and the trimmed label", async () => {
    const f = fakeFetch({ status: 201, body: MINTED });
    const client = createAwlClient({ session: session().s, fetch: f.fn });
    const m = await client.mint({ projectId: "p1", level: 0, days: 7, label: "  my assistant  " });
    expect(f.calls[0].url).toBe(`${AWL_URL}/mint`);
    expect(f.calls[0].init.method).toBe("POST");
    expect(f.calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(f.calls[0].init.headers.Authorization).toBe("Bearer T-first");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ projectId: "p1", level: 0, days: 7, label: "my assistant" });
    expect(m).toMatchObject({ linkId: "lnk_1", level: 0, link: LINK, inbox: null, label: "my assistant", shell: false, project: { id: "p1", name: "Tower A" } });
  });

  test("mint: a blank label is left out of the body", async () => {
    const f = fakeFetch({ status: 201, body: MINTED });
    await createAwlClient({ session: session().s, fetch: f.fn }).mint({ projectId: "p1", level: 1, days: 30, label: "   " });
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ projectId: "p1", level: 1, days: 30 });
  });

  test("mint: an answer with no link is refused", async () => {
    const f = fakeFetch({ status: 201, body: { ...MINTED, links: {} } });
    await expect(createAwlClient({ session: session().s, fetch: f.fn }).mint({ projectId: "p1", level: 0, days: 7 })).rejects.toMatchObject({ code: "BAD_ANSWER" });
  });

  test("links: GET /links?project= and the three states of a row", async () => {
    const base = { project_id: "p1", project_name: "Tower A", label: null, level: 0, created_at: "2026-09-26T10:00:00Z", last_used_at: null };
    const f = fakeFetch({
      status: 200,
      body: {
        links: [
          { ...base, id: "a", expires_at: "2026-10-03T10:00:00Z", revoked_at: null, active: true },
          { ...base, id: "b", expires_at: "2026-09-01T10:00:00Z", revoked_at: null, active: false },
          { ...base, id: "c", expires_at: "2026-10-03T10:00:00Z", revoked_at: "2026-09-27T10:00:00Z", active: false },
        ],
      },
    });
    const rows = await createAwlClient({ session: session().s, fetch: f.fn }).links("p1");
    expect(f.calls[0].url).toBe(`${AWL_URL}/links?project=p1`);
    expect(f.calls[0].init.method).toBe("GET");
    expect(rows.map((r) => [r.id, r.status])).toEqual([["a", "active"], ["b", "expired"], ["c", "revoked"]]);
  });

  test("revoke: POST /links/<id>/revoke with the id encoded and no body", async () => {
    const f = fakeFetch({ status: 200, body: { link_id: "a/b", revoked: true, already: false } });
    const r = await createAwlClient({ session: session().s, fetch: f.fn }).revoke("a/b");
    expect(f.calls[0].url).toBe(`${AWL_URL}/links/a%2Fb/revoke`);
    expect(f.calls[0].init.method).toBe("POST");
    expect(f.calls[0].init.body).toBeUndefined();
    expect(r).toEqual({ linkId: "a/b", revoked: true, already: false });
  });

  test("newProject: POST /new-project with the days, and the answer is marked as a shell project", async () => {
    const f = fakeFetch({ status: 201, body: { shell: true, product_id: null, ...MINTED, project: { id: "shell1", name: "New project" } } });
    const m = await createAwlClient({ session: session().s, fetch: f.fn }).newProject({ days: 7 });
    expect(f.calls[0].url).toBe(`${AWL_URL}/new-project`);
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ days: 7 });
    expect(m).toMatchObject({ shell: true, project: { id: "shell1", name: "New project" }, link: LINK });
  });
});

describe("a stale session", () => {
  test("SESSION_STALE refreshes the session and sends the same request once more with the new token", async () => {
    const f = fakeFetch({ status: 401, body: { error: "Sign in again to make a link: this session is more than 15 minutes old.", status: 401, code: "SESSION_STALE" } }, { status: 201, body: MINTED });
    const { s, seen } = session("T-old", "T-new");
    const m = await createAwlClient({ session: s, fetch: f.fn }).mint({ projectId: "p1", level: 0, days: 7 });
    expect(m.link).toBe(LINK);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].init.headers.Authorization).toBe("Bearer T-old");
    expect(f.calls[1].init.headers.Authorization).toBe("Bearer T-new");
    expect(f.calls[1].init.body).toBe(f.calls[0].init.body);
    expect(seen).toEqual({ accessToken: 1, refresh: 1 });
  });

  test("a second SESSION_STALE is an error: the request is sent twice and never a third time", async () => {
    const stale = { status: 401, body: { error: "Sign in again to make a link: this session is more than 15 minutes old.", status: 401, code: "SESSION_STALE" } };
    const f = fakeFetch(stale, stale);
    const { s, seen } = session();
    const error = await createAwlClient({ session: s, fetch: f.fn }).mint({ projectId: "p1", level: 0, days: 7 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AwlError);
    expect((error as AwlError).code).toBe("SESSION_STALE");
    expect(f.calls).toHaveLength(2);
    expect(seen.refresh).toBe(1);
  });

  test("another 401 is not retried", async () => {
    const f = fakeFetch({ status: 401, body: { error: "Your session is not valid. Sign in again.", status: 401, code: "SESSION_INVALID" } });
    const { s, seen } = session();
    await expect(createAwlClient({ session: s, fetch: f.fn }).links("p1")).rejects.toMatchObject({ status: 401, code: "SESSION_INVALID" });
    expect(f.calls).toHaveLength(1);
    expect(seen.refresh).toBe(0);
  });

  test("a refresh that yields no token stops with a sign-in message and sends nothing more", async () => {
    const f = fakeFetch({ status: 401, body: { error: "stale", status: 401, code: "SESSION_STALE" } });
    const { s } = session("T-old", null);
    await expect(createAwlClient({ session: s, fetch: f.fn }).mint({ projectId: "p1", level: 0, days: 7 })).rejects.toMatchObject({ code: "SESSION_REQUIRED" });
    expect(f.calls).toHaveLength(1);
  });
});

describe("refusals and failures", () => {
  test("no session token: nothing is sent", async () => {
    const f = fakeFetch();
    await expect(createAwlClient({ session: session(null).s, fetch: f.fn }).warning("p1", 0)).rejects.toMatchObject({ status: 401, code: "SESSION_REQUIRED" });
    expect(f.calls).toHaveLength(0);
  });

  test("a coded refusal keeps the service's own plain sentence and code", async () => {
    const f = fakeFetch({ status: 429, body: { error: "You made 10 links in the last hour. Wait before making another.", status: 429, code: "MINT_CAP_HOUR" } });
    await expect(createAwlClient({ session: session().s, fetch: f.fn }).mint({ projectId: "p1", level: 0, days: 7 })).rejects.toMatchObject({
      status: 429,
      code: "MINT_CAP_HOUR",
      message: "You made 10 links in the last hour. Wait before making another.",
    });
  });

  test("a network failure is status 0 with a plain sentence", async () => {
    const f = fakeFetch("throw");
    const error = await createAwlClient({ session: session().s, fetch: f.fn }).links("p1").catch((e: unknown) => e);
    expect((error as AwlError).status).toBe(0);
    expect((error as AwlError).message).toContain("Could not reach");
  });
});

describe("the token goes nowhere but back to the caller", () => {
  const written: string[] = [];
  const consoleLines: string[] = [];
  const restore: Array<() => void> = [];

  function fakeStorage(name: string) {
    const target = {
      setItem: (k: string, v: string) => void written.push(`${name}:${k}=${v}`),
      getItem: () => null,
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    const had = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value: target, configurable: true, writable: true });
    restore.push(() => {
      if (had) Object.defineProperty(globalThis, name, had);
      else delete (globalThis as Record<string, unknown>)[name];
    });
  }

  beforeEach(() => {
    written.length = 0;
    consoleLines.length = 0;
    fakeStorage("localStorage");
    fakeStorage("sessionStorage");
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      const spy = spyOn(console, m).mockImplementation((...args: unknown[]) => void consoleLines.push(args.map(String).join(" ")));
      restore.push(() => spy.mockRestore());
    }
  });
  afterEach(() => {
    while (restore.length) restore.pop()!();
  });

  test("a mint, a list and a revoke put the token in no URL, no storage and no console line", async () => {
    const f = fakeFetch({ status: 201, body: MINTED }, { status: 200, body: { links: [] } }, { status: 200, body: { link_id: "lnk_1", revoked: true, already: false } });
    const client = createAwlClient({ session: session().s, fetch: f.fn });
    const m = await client.mint({ projectId: "p1", level: 0, days: 7 });
    await client.links("p1");
    await client.revoke(m.linkId);
    // the caller has the link (that is the point) ...
    expect(m.link).toContain(TOKEN);
    // ... and nothing else does
    for (const call of f.calls) {
      expect(call.url).not.toContain(TOKEN);
      expect(call.url).not.toContain("pxa_");
      expect(String(call.init.body ?? "")).not.toContain(TOKEN);
    }
    expect(written).toEqual([]);
    expect(consoleLines.join("\n")).not.toContain(TOKEN);
    expect(consoleLines.join("\n")).not.toContain("T-first");
  });

  test("a refusal that follows a mint carries no token in its message", async () => {
    const f = fakeFetch({ status: 503, body: { error: "Service unavailable. Try again in a minute.", status: 503, code: "MINT_UNAVAILABLE", hint: "Nothing was changed." } });
    const error = await createAwlClient({ session: session().s, fetch: f.fn }).mint({ projectId: "p1", level: 0, days: 7 }).catch((e: unknown) => e);
    expect((error as AwlError).message).not.toContain("pxa_");
    expect(written).toEqual([]);
    expect(consoleLines).toEqual([]);
  });
});
