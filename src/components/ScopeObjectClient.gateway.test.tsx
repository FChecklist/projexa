/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33 (BR-419, BR-420 at unit level). The BOQ Object Page with the browser-first switches: off, it reads the usual way
// and shows no search panel; with the gateway switch on it reads the line items from the gateway with the signed-in person's token; with
// browser-first on it keeps a copy on the device and shows those lines again with no network. The end-to-end proof in a real browser is
// e2e/boq-offline.spec.ts and e2e/boq-worker-filter.spec.ts.
import "fake-indexeddb/auto";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}) }),
  usePathname: () => "/scope/boq-1",
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));
// The signed-in browser: a session with a token. The real module exports only createClient, so nothing else is lost by replacing it.
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "tok-user-1", user: { id: "user-1" } } } }) },
  }),
}));

const ScopeObjectClient = (await import("./ScopeObjectClient")).default;
const { __resetCurrenciesCacheForTests } = await import("@/lib/currency");
const { clearBoqDeviceCopy, readProjectLines } = await import("@/lib/boq-line-cache");
const { BOQ_READ_GATEWAY_URL } = await import("@/lib/boq-gateway-client");

const realFetch = globalThis.fetch;
const onlineDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine");

function setOnline(value: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", { value, configurable: true });
}

beforeEach(async () => {
  await clearBoqDeviceCopy("user-1");
});
afterEach(async () => {
  cleanup();
  __resetCurrenciesCacheForTests();
  globalThis.fetch = realFetch;
  if (onlineDescriptor) Object.defineProperty(globalThis.navigator, "onLine", onlineDescriptor);
  else setOnline(true);
  await clearBoqDeviceCopy("user-1");
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const header = {
  id: "boq-1", projectId: "proj-1", version: 1, title: "Villa 21 - Interior Fit-out", status: "approved", parentBoqId: null, createdAt: "2026-08-28T00:00:00.000Z",
};

function gline(n: number, boqId: string, description: string) {
  return {
    id: `line-${String(n).padStart(4, "0")}`, boqId, boqTitle: boqId === "boq-1" ? "Villa 21 - Interior Fit-out" : "Villa 22", boqVersion: 1,
    boqStatus: boqId === "boq-1" ? "approved" : "draft", parentLineItemId: null, activityId: null, itemCode: `IC-${n}`, category: "Civil",
    description, unit: "m3", quantity: "10", rate: "5", amount: "50", createdAt: "2026-09-01T00:00:00Z",
  };
}

// 2 lines in this BOQ and 3 in another one of the same project.
const PROJECT_LINES = [
  gline(1, "boq-1", "Gateway slab"), gline(2, "boq-2", "Other BOQ steel"), gline(3, "boq-1", "Gateway column"),
  gline(4, "boq-2", "Other BOQ paint"), gline(5, "boq-2", "Other BOQ tiles"),
];

// `requests` is every request that is not a gateway request (path and query), recorded before it is answered, so a test can say which
// requests a screen did NOT send.
type Seen = { gateway: Array<{ url: URL; headers: Record<string, string>; credentials?: RequestCredentials }>; scopeGets: string[]; requests: string[] };

/** Routes the fake global fetch. `gatewayUp` false makes the gateway unreachable, like a dropped connection. */
function network(seen: Seen, gatewayUp: () => boolean) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (!String(input).startsWith(BOQ_READ_GATEWAY_URL)) seen.requests.push(url.pathname + url.search);
    if (String(input).startsWith(BOQ_READ_GATEWAY_URL)) {
      if (!gatewayUp()) throw new TypeError("Failed to fetch");
      seen.gateway.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, credentials: init?.credentials });
      return jsonRes({ fn: "boq_lines", projectId: "proj-1", rows: PROJECT_LINES, nextAfter: null });
    }
    if (url.pathname === "/api/scope/boq-1") {
      seen.scopeGets.push(url.pathname);
      // The proxy's own line: must not be what the screen shows when the gateway switch is on.
      return jsonRes({
        ...header,
        lineItems: [{ id: "proxy-1", itemCode: null, description: "Proxy line", unit: "m3", quantity: "1", rate: "1", amount: "1", activityId: null }],
      });
    }
    if (url.pathname === "/api/vendors") return jsonRes({ vendors: [] });
    if (url.pathname === "/api/currencies") return jsonRes({ currencies: [{ code: "AED", isBaseCurrency: true }] });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

function legacyTable(container: HTMLElement) {
  return within(container.querySelector('[data-testid="boq-legacy-detail-grid"]') as HTMLElement);
}

describe("switches off", () => {
  test("the page reads the usual way: no gateway request, no search panel, the proxy's line is shown", async () => {
    const seen: Seen = { gateway: [], scopeGets: [], requests: [] };
    network(seen, () => true);
    const { container, findByText, queryAllByTestId } = render(<ScopeObjectClient boqId="boq-1" />);
    await findByText("Villa 21 - Interior Fit-out");
    expect(seen.gateway.length).toBe(0);
    // Counts, not queryBy...().toBeNull(): a failed toBeNull() makes bun print the whole DOM element, which takes minutes.
    expect(queryAllByTestId("boq-line-explorer").length).toBe(0);
    expect(legacyTable(container).getByText("Proxy line")).toBeDefined();
  });
});

describe("gateway switch on", () => {
  const flags = { viaGateway: true, browserFirst: false };

  test("the screen's lines come from the gateway, filtered to this BOQ, and the request carries the token as Bearer and no cookie", async () => {
    const seen: Seen = { gateway: [], scopeGets: [], requests: [] };
    network(seen, () => true);
    const { container, findByText, queryAllByText, queryAllByTestId } = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    await findByText("Villa 21 - Interior Fit-out");
    await waitFor(() => expect(legacyTable(container).getByText("Gateway slab")).toBeDefined());
    expect(legacyTable(container).getByText("Gateway column")).toBeDefined();
    expect(legacyTable(container).queryAllByText("Proxy line").length).toBe(0);
    expect(queryAllByText("Other BOQ steel").length).toBe(0);
    expect(queryAllByTestId("boq-line-explorer").length).toBe(0);

    expect(seen.gateway.length).toBe(1);
    expect(seen.gateway[0].headers).toEqual({ Authorization: "Bearer tok-user-1" });
    expect(seen.gateway[0].credentials).toBe("omit");
    expect(seen.gateway[0].url.searchParams.get("projectId")).toBe("proj-1");
  });

  test("a gateway that answers 503 (its switch is off) leaves the screen readable through the proxy", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (String(input).startsWith(BOQ_READ_GATEWAY_URL)) return jsonRes({ error: "off" }, 503);
      if (url.pathname === "/api/scope/boq-1") {
        return jsonRes({ ...header, lineItems: [{ id: "proxy-1", itemCode: null, description: "Proxy line", unit: "m3", quantity: "1", rate: "1", amount: "1", activityId: null }] });
      }
      if (url.pathname === "/api/vendors") return jsonRes({ vendors: [] });
      if (url.pathname === "/api/currencies") return jsonRes({ currencies: [] });
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;
    const { container, findByText } = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    await findByText("Villa 21 - Interior Fit-out");
    await waitFor(() => expect(legacyTable(container).getByText("Proxy line")).toBeDefined());
    expect(await findByText(/switched off, so this BOQ was read the usual way/)).toBeDefined();
  });
});

describe("browser-first on", () => {
  const flags = { viaGateway: true, browserFirst: true };

  test("the search panel appears with the project's lines, the engine is named, and the scope switch reaches the other BOQs of the project", async () => {
    const seen: Seen = { gateway: [], scopeGets: [], requests: [] };
    network(seen, () => true);
    const { findByTestId, findByText, getAllByTestId } = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    await findByText("Villa 21 - Interior Fit-out");
    const panel = await findByTestId("boq-line-explorer");
    expect(panel.getAttribute("data-indexed-lines")).toBe("5");
    expect(["worker", "main"]).toContain(panel.getAttribute("data-filter-engine") ?? "");
    await waitFor(() => expect(getAllByTestId("boq-explorer-row").length).toBe(2));

    fireEvent.click(within(panel).getByRole("button", { name: "All BOQs in project" }));
    await waitFor(() => expect(getAllByTestId("boq-explorer-row").length).toBe(5));
    fireEvent.click(within(panel).getByRole("button", { name: "This BOQ" }));
    await waitFor(() => expect(getAllByTestId("boq-explorer-row").length).toBe(2));
  });

  test("after one online load the lines show again with no network: from the device copy, with the gateway never asked", async () => {
    const seen: Seen = { gateway: [], scopeGets: [], requests: [] };
    let up = true;
    network(seen, () => up);
    const first = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    await first.findByText("Villa 21 - Interior Fit-out");
    await waitFor(() => expect(legacyTable(first.container).getByText("Gateway slab")).toBeDefined());
    expect(seen.gateway.length).toBe(1);
    cleanup();

    // The network goes away. The person opens the screen again (a fresh mount) and it must render from the device.
    up = false;
    setOnline(false);
    const second = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    await second.findByText("Villa 21 - Interior Fit-out");
    await waitFor(() => expect(legacyTable(second.container).getByText("Gateway slab")).toBeDefined());
    expect(legacyTable(second.container).getByText("Gateway column")).toBeDefined();
    expect(seen.gateway.length).toBe(1);
    expect(await second.findByText(/Offline: showing the 2 lines of this BOQ saved on this device/)).toBeDefined();
    // the search panel works from the device copy too
    await waitFor(() => expect(second.getAllByTestId("boq-explorer-row").length).toBe(2));
  });

  test("Refresh lines while offline shows the device copy instead of an error", async () => {
    const seen: Seen = { gateway: [], scopeGets: [], requests: [] };
    let up = true;
    network(seen, () => up);
    const view = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    await view.findByText("Villa 21 - Interior Fit-out");
    await waitFor(() => expect(legacyTable(view.container).getByText("Gateway slab")).toBeDefined());

    up = false;
    setOnline(false);
    fireEvent.click(view.getByRole("button", { name: "Refresh lines" }));
    expect(await view.findByText(/Offline: showing the 2 lines/)).toBeDefined();
    await waitFor(() => expect(legacyTable(view.container).getByText("Gateway column")).toBeDefined());
    expect(view.queryAllByRole("alert").length).toBe(0);
  });

  test("offline with no copy saved says so", async () => {
    const seen: Seen = { gateway: [], scopeGets: [], requests: [] };
    network(seen, () => false);
    setOnline(false);
    const view = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    expect((await view.findByRole("alert")).textContent).toContain("has not been opened online on this device yet");
    expect(seen.gateway.length).toBe(0);
  });

  test("a load from the device copy sends none of the revision-banner requests (predecessor list, variation, site instruction)", async () => {
    const seen: Seen = { gateway: [], scopeGets: [], requests: [] };
    let up = true;
    network(seen, () => up);
    const first = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    await first.findByText("Villa 21 - Interior Fit-out");
    await waitFor(() => expect(legacyTable(first.container).getByText("Gateway slab")).toBeDefined());
    // The same reads ARE sent when the lines come from the gateway, which shows this recorder can see them.
    await waitFor(() => expect(seen.requests.some((r) => r.startsWith("/api/scope?projectId=proj-1"))).toBe(true));
    expect(seen.requests.some((r) => r.startsWith("/api/site-instructions?projectId=proj-1"))).toBe(true);
    cleanup();

    seen.requests.length = 0;
    up = false;
    setOnline(false);
    const second = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    expect(await second.findByText(/Offline: showing the 2 lines of this BOQ saved on this device/)).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bannerReads = seen.requests.filter((r) => r.startsWith("/api/scope?") || r.includes("/compare") || r.startsWith("/api/site-instructions"));
    expect(bannerReads).toEqual([]);
  });
});

// Submit and Approve reload the BOQ through the proxy (afterWrite in src/lib/boq-read-source.ts). That reload does not refill the search
// index, so the screen must keep showing the search panel over the index it still holds.
describe("a reload after a write", () => {
  const flags = { viaGateway: true, browserFirst: true };

  test("Approve reloads through the proxy and the search panel stays, over the same index, without another project download", async () => {
    let status = "submitted";
    let gatewayCalls = 0;
    let approvePosts = 0;
    // The index is filled while this BOQ is submitted, so its rows carry that status.
    const lines = PROJECT_LINES.map((l) => (l.boqId === "boq-1" ? { ...l, boqStatus: "submitted" } : l));
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (String(input).startsWith(BOQ_READ_GATEWAY_URL)) {
        gatewayCalls += 1;
        return jsonRes({ fn: "boq_lines", projectId: "proj-1", rows: lines, nextAfter: null });
      }
      if (url.pathname === "/api/scope/boq-1/approve" && init?.method === "POST") {
        approvePosts += 1;
        status = "approved";
        return jsonRes({ ok: true });
      }
      if (url.pathname === "/api/scope/boq-1") return jsonRes({ ...header, status, lineItems: [] });
      if (url.pathname === "/api/vendors") return jsonRes({ vendors: [] });
      if (url.pathname === "/api/currencies") return jsonRes({ currencies: [{ code: "AED", isBaseCurrency: true }] });
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    const view = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    expect((await view.findByTestId("boq-line-explorer")).getAttribute("data-indexed-lines")).toBe("5");
    expect(gatewayCalls).toBe(1);

    fireEvent.click(await view.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approvePosts).toBe(1));
    // The reload has ended when the Approve button is gone (the BOQ reads approved now) and the toolbar is back.
    await waitFor(() => {
      expect(view.queryAllByRole("button", { name: "Approve" }).length).toBe(0);
      expect(view.queryAllByRole("button", { name: "Refresh lines" }).length).toBe(1);
    });

    const panels = view.queryAllByTestId("boq-line-explorer");
    expect(panels.length).toBe(1);
    expect(panels[0].getAttribute("data-indexed-lines")).toBe("5");
    expect(gatewayCalls).toBe(1); // the project was not downloaded again

    // The index still holds the status this BOQ had when it was filled; the panel labels this BOQ from the screen instead.
    fireEvent.click(within(panels[0]).getByRole("button", { name: "All BOQs in project" }));
    await waitFor(() => expect(view.getAllByTestId("boq-explorer-row").length).toBe(5));
    const own = view.getAllByTestId("boq-explorer-row").map((r) => r.textContent ?? "").filter((t) => t.includes("Gateway "));
    expect(own.length).toBe(2);
    for (const text of own) {
      expect(text).toContain("(approved)");
      expect(text.includes("(submitted)")).toBe(false);
    }
  });
});

// The screen's load() can run again while an earlier run is still going, and both share one search index. Only the newest run may change
// the screen or the index (isCurrent in src/lib/boq-read-source.ts, the load counter in ScopeObjectClient.tsx).
describe("a load that a newer one replaces", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const header2 = { ...header, id: "boq-2", title: "Villa 22", status: "draft" };

  /** A network for two BOQs of one project. The first request of the named kind is held until release() is called. */
  function twoBoqNetwork(holdFirst: "gateway" | "boq-1") {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const calls = { gateway: 0, boq1: 0 };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (String(input).startsWith(BOQ_READ_GATEWAY_URL)) {
        calls.gateway += 1;
        if (holdFirst === "gateway" && calls.gateway === 1) await held;
        return jsonRes({ fn: "boq_lines", projectId: "proj-1", rows: PROJECT_LINES, nextAfter: null });
      }
      if (url.pathname === "/api/scope/boq-1") {
        calls.boq1 += 1;
        if (holdFirst === "boq-1" && calls.boq1 === 1) await held;
        return jsonRes({ ...header, lineItems: [] });
      }
      if (url.pathname === "/api/scope/boq-2") return jsonRes({ ...header2, lineItems: [] });
      if (url.pathname === "/api/vendors") return jsonRes({ vendors: [] });
      if (url.pathname === "/api/currencies") return jsonRes({ currencies: [{ code: "AED", isBaseCurrency: true }] });
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;
    return { release, calls };
  }

  test("the route moves to another BOQ of the project while the first load is downloading: the second BOQ stays on screen and the project search lists each line once", async () => {
    const net = twoBoqNetwork("gateway");
    const view = render(<ScopeObjectClient boqId="boq-1" readFlags={{ viaGateway: true, browserFirst: true }} />);
    await waitFor(() => expect(net.calls.gateway).toBe(1)); // the first load waits on the gateway
    view.rerender(<ScopeObjectClient boqId="boq-2" readFlags={{ viaGateway: true, browserFirst: true }} />);
    await view.findByText("Villa 22");
    const panel = await view.findByTestId("boq-line-explorer");
    net.release(); // the first load's page arrives late
    await sleep(150);

    // Counts, not queryBy...().toBeNull(): a failed toBeNull() makes bun print the whole DOM element, which takes minutes.
    expect(view.queryAllByText("Villa 21 - Interior Fit-out").length).toBe(0);
    expect(view.getByText("Villa 22")).toBeDefined();
    fireEvent.click(within(panel).getByRole("button", { name: "All BOQs in project" }));
    await waitFor(() => expect(view.getAllByTestId("boq-explorer-row").length).toBe(5));
    expect(view.getByTestId("boq-explorer-count").textContent).toMatch(/Showing 5 of 5 matching lines \(5 in /);
  });

  test("switches off: an answer for the first BOQ that arrives after the screen moved on does not replace the second BOQ", async () => {
    const net = twoBoqNetwork("boq-1");
    const view = render(<ScopeObjectClient boqId="boq-1" />);
    await waitFor(() => expect(net.calls.boq1).toBe(1));
    view.rerender(<ScopeObjectClient boqId="boq-2" />);
    await view.findByText("Villa 22");
    net.release();
    await sleep(150);
    expect(view.queryAllByText("Villa 21 - Interior Fit-out").length).toBe(0);
    expect(view.getByText("Villa 22")).toBeDefined();
  });

  test("the screen stays in its loading state until the newest load ends: an older load that ends first does not bring the Refresh button back", async () => {
    const flags = { viaGateway: true, browserFirst: true };
    // Gateway request 1 answers at once (the first load, which finishes). Requests 2 (a Refresh) and 3 (the load after the route moved
    // to another BOQ) are held until the test opens them.
    const releases: Array<() => void> = [];
    let gatewayCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (String(input).startsWith(BOQ_READ_GATEWAY_URL)) {
        gatewayCalls += 1;
        const n = gatewayCalls;
        if (n >= 2) await new Promise<void>((resolve) => { releases[n] = resolve; });
        return jsonRes({ fn: "boq_lines", projectId: "proj-1", rows: PROJECT_LINES, nextAfter: null });
      }
      if (url.pathname === "/api/scope/boq-1") return jsonRes({ ...header, lineItems: [] });
      if (url.pathname === "/api/scope/boq-2") return jsonRes({ ...header2, lineItems: [] });
      if (url.pathname === "/api/vendors") return jsonRes({ vendors: [] });
      if (url.pathname === "/api/currencies") return jsonRes({ currencies: [{ code: "AED", isBaseCurrency: true }] });
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    const view = render(<ScopeObjectClient boqId="boq-1" readFlags={flags} />);
    await view.findByText("Villa 21 - Interior Fit-out");
    fireEvent.click(await view.findByRole("button", { name: "Refresh lines" }));
    await waitFor(() => expect(gatewayCalls).toBe(2)); // the Refresh is downloading, and the screen is in its loading state
    expect(view.queryAllByRole("button", { name: "Refresh lines" }).length).toBe(0);
    view.rerender(<ScopeObjectClient boqId="boq-2" readFlags={flags} />);
    await waitFor(() => expect(gatewayCalls).toBe(3)); // the newer load is downloading

    releases[2](); // the older load ends first
    await sleep(150);
    expect(view.queryAllByRole("button", { name: "Refresh lines" }).length).toBe(0); // still loading: the newer load is not done

    releases[3]();
    await view.findByText("Villa 22");
    expect(view.getByRole("button", { name: "Refresh lines" })).toBeDefined();
  });

  test("leaving the screen while it is downloading drops the load: no device copy is saved afterwards", async () => {
    const net = twoBoqNetwork("gateway");
    const view = render(<ScopeObjectClient boqId="boq-1" readFlags={{ viaGateway: true, browserFirst: true }} />);
    await waitFor(() => expect(net.calls.gateway).toBe(1));
    view.unmount();
    net.release();
    await sleep(200);
    expect(await readProjectLines("user-1", "proj-1", () => {})).toBeNull();
  });
});
