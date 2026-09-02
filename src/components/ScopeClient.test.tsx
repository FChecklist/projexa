/// <reference types="bun-types" />
// R67 F-04 (R-060/R-063) acceptance test.
//
// THE BUG. After the BOQ list arrived, this component fired
// GET /api/scope/{id}/compare once PER REVISION to fill the "Variation vs.
// prior" column. On an eight-revision project that was eight extra calls at
// 0.58-1.44 s each -- 22 requests and 7.7 s to network idle -- on a screen
// whose backend answers /scope in 652-781 ms. Server-side it was worse: the
// list handler ran Promise.all(boqs.map(getBoq)) and each getBoq() opened its
// OWN transaction against a five-connection pool.
//
// THE CONTRACT NOW. Exactly one /api/scope call on mount, zero /compare
// calls, and the variation cell renders from the row payload.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, which ESM runs before this file's
// body -- i.e. before GlobalRegistrator.register() creates `document`.
import { cleanup, render, waitFor } from "@testing-library/react";

const prefetch = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), prefetch }),
}));

// Dynamically imported so this module -- and its transitive Radix/kit chain,
// which decides real-vs-noop useLayoutEffect from a module-scope
// `globalThis?.document` check -- is evaluated AFTER register() has run.
const ScopeClient = (await import("./ScopeClient")).default;
const { __resetCurrenciesCacheForTests } = await import("@/lib/currency");

afterEach(() => {
  cleanup();
  __resetCurrenciesCacheForTests();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Eight revisions off one baseline -- the exact shape the audit measured. */
function eightRevisionFixture() {
  const boqs = [
    {
      id: "rev0",
      version: 1,
      title: "Villa 12 -- BOQ",
      status: "approved",
      parentBoqId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      totalVariation: null,
      totalVariationVsOriginal: null,
    },
  ];
  for (let i = 1; i <= 8; i++) {
    boqs.push({
      id: `rev${i}`,
      version: i + 1,
      title: `Villa 12 -- BOQ`,
      status: i === 8 ? "draft" : "superseded",
      parentBoqId: `rev${i - 1}`,
      createdAt: `2026-0${i}-15T00:00:00.000Z`,
      totalVariation: i * 1000,
      totalVariationVsOriginal: i * 1000,
    });
  }
  return boqs;
}

function stubFetch(boqs: unknown[]) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] });
    if (url.includes("/api/scope")) return jsonRes({ boqs });
    return jsonRes({});
  }) as typeof fetch;
  return calls;
}

describe("ScopeClient -- one list call, no per-revision compare fan-out", () => {
  test("mounts with exactly ONE /api/scope call and ZERO /compare calls", async () => {
    const calls = stubFetch(eightRevisionFixture());

    const { findAllByText } = render(<ScopeClient projectId="proj-1" />);
    // nine rows share the title, so wait on all of them rather than one
    await findAllByText("Villa 12 -- BOQ");
    // let any stray follow-up request settle before counting
    await waitFor(() => expect(calls.some((u) => u.includes("/api/scope"))).toBe(true));

    const scopeCalls = calls.filter((u) => u.includes("/api/scope"));
    expect(scopeCalls).toHaveLength(1);
    expect(scopeCalls[0]).toContain("projectId=proj-1");

    const compareCalls = calls.filter((u) => /\/api\/scope\/[^/]+\/compare/.test(u));
    expect(compareCalls).toHaveLength(0);
  });

  test("the variation cell renders from the row payload", async () => {
    stubFetch(eightRevisionFixture());

    const { findAllByText, container } = render(<ScopeClient projectId="proj-1" />);
    await findAllByText("Villa 12 -- BOQ");

    // The cell is "<currency code> <formatted amount>" across two text nodes,
    // so assert on the rendered text rather than a single-node match.
    // rev1's totalVariation is 1000, formatted with a leading + for a gain.
    expect(container.textContent).toContain("+1,000");
    // rev8's is 8000 -- proving every row reads its OWN figure, not one shared.
    expect(container.textContent).toContain("+8,000");
  });

  test("a baseline revision says so instead of showing a fabricated zero", async () => {
    stubFetch(eightRevisionFixture());

    const { findByText } = render(<ScopeClient projectId="proj-1" />);

    expect(await findByText("Baseline (Rev0)")).toBeDefined();
  });

  test("a null variation on a revision renders a dash, never 0", async () => {
    stubFetch([
      {
        id: "rev0", version: 1, title: "Baseline", status: "approved", parentBoqId: null,
        createdAt: "2026-01-01T00:00:00.000Z", totalVariation: null, totalVariationVsOriginal: null,
      },
      {
        id: "rev1", version: 2, title: "Orphan revision", status: "draft", parentBoqId: "gone",
        createdAt: "2026-02-01T00:00:00.000Z", totalVariation: null, totalVariationVsOriginal: null,
      },
    ]);

    const { findByText, container } = render(<ScopeClient projectId="proj-1" />);
    await findByText("Orphan revision");

    expect(container.textContent).toContain("—");
    // the honest dash, not a confident zero
    expect(container.textContent).not.toContain("+0");
  });

  test("the skeleton carries the real column headers while loading", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/scope")) {
        await gate;
        return jsonRes({ boqs: [] });
      }
      return jsonRes({ currencies: [] });
    }) as typeof fetch;

    const { findByText } = render(<ScopeClient projectId="proj-1" />);

    expect(await findByText("Loading BOQs...")).toBeDefined();
    expect(await findByText("Variation vs. prior")).toBeDefined();
    release?.();
  });

  test("a failed load shows the backend's own words with a Retry", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/scope")) return jsonRes({ error: "No organisation on this account" }, 400);
      return jsonRes({ currencies: [] });
    }) as typeof fetch;

    const { findByText } = render(<ScopeClient projectId="proj-1" />);

    expect(await findByText(/No organisation on this account/)).toBeDefined();
  });
});
