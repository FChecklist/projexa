/// <reference types="bun-types" />
// R67 F-05 (R-075) — the provider that made the Work Progress tabs share one
// load instead of three. It is the piece of F-05 carrying real logic (a
// project-keyed TTL cache, two deliberately independent loads, and a write
// path that must bypass the cache), so its behaviour is pinned here rather
// than left to be exercised incidentally through WorkProgressPageClient.
//
// The four properties below are the ones a future edit could quietly break
// while every screen still "works":
//
//   1. a tab switch inside the TTL costs NO request -- that is the whole point
//      of the provider, and it is invisible on screen when it regresses;
//   2. the list is never gated on activities. Activities exist for the form's
//      Activity select; under the old Promise.all a slow activities lookup
//      held back rows that were already in hand;
//   3. reload() -- what a successful write calls -- must not read the cache,
//      or a user would file an entry and not see it;
//   4. an activities failure must not raise the list's error card, and an
//      entries failure must show the BACKEND's words, not a blank list dressed
//      up as "no entries".
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, render, waitFor } from "@testing-library/react";

const { WorkProgressDataProvider, useWorkProgressData, __resetWorkProgressCacheForTests } = await import(
  "./WorkProgressDataProvider"
);

afterEach(() => {
  cleanup();
  __resetWorkProgressCacheForTests();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

// bun test runs every file in ONE process, so under a full-suite run these
// renders share a machine with every other suite.
const WAIT = { timeout: 8_000 } as const;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ENTRY = {
  id: "e1",
  activityId: "a1",
  boqLineItemId: "b1",
  entryDate: "2026-09-01",
  quantityDone: "12",
  percentComplete: "40",
  entryBasis: "quantity",
  remarks: null,
  activityName: "Blockwork",
  boqItemCode: "1.2.3",
  boqLineDescription: "200mm blockwork",
  unit: "sqm",
};

type StubOptions = {
  entriesFail?: boolean;
  activitiesFail?: boolean;
  /** Hold the activities response open so the "list is not gated" case is real. */
  holdActivities?: boolean;
};

function stubFetch(options: StubOptions = {}) {
  const calls: string[] = [];
  let releaseActivities: (() => void) | null = null;
  const activitiesGate = options.holdActivities
    ? new Promise<void>((resolve) => {
        releaseActivities = resolve;
      })
    : Promise.resolve();

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/work-progress/activities")) {
      await activitiesGate;
      return options.activitiesFail
        ? jsonRes({ error: "VERIDIAN did not respond in time" }, 504)
        : jsonRes({ activities: [{ id: "a1", name: "Blockwork" }] });
    }
    if (url.includes("/api/work-progress")) {
      return options.entriesFail
        ? jsonRes({ error: "VERIDIAN did not respond in time" }, 504)
        : jsonRes({ entries: [ENTRY] });
    }
    return jsonRes({});
  }) as typeof fetch;

  return { calls, release: () => releaseActivities?.() };
}

/** A consumer that renders exactly what the provider exposes, and nothing else. */
function Probe({ onReload }: { onReload?: (reload: () => Promise<void>) => void } = {}) {
  const { entries, activities, entriesLoading, activitiesLoading, entriesError, reload } = useWorkProgressData();
  onReload?.(reload);
  return (
    <div>
      <span data-testid="entries">{entries.map((e) => e.activityName).join(",")}</span>
      <span data-testid="activities">{activities.map((a) => a.name).join(",")}</span>
      <span data-testid="entries-loading">{String(entriesLoading)}</span>
      <span data-testid="activities-loading">{String(activitiesLoading)}</span>
      <span data-testid="entries-error">{entriesError ?? ""}</span>
    </div>
  );
}

function renderProvider(projectId = "p1", onReload?: (reload: () => Promise<void>) => void) {
  return render(
    <WorkProgressDataProvider projectId={projectId}>
      <Probe onReload={onReload} />
    </WorkProgressDataProvider>
  );
}

describe("WorkProgressDataProvider", () => {
  test("loads entries and activities once each, scoped to the project", async () => {
    const { calls } = stubFetch();

    const { getByTestId } = renderProvider("p1");

    await waitFor(() => expect(getByTestId("entries").textContent).toBe("Blockwork"), WAIT);

    const entryCalls = calls.filter((u) => u.includes("/api/work-progress?"));
    const activityCalls = calls.filter((u) => u.includes("/api/work-progress/activities"));
    expect(entryCalls).toHaveLength(1);
    expect(activityCalls).toHaveLength(1);
    expect(entryCalls[0]).toContain("projectId=p1");
    expect(activityCalls[0]).toContain("projectId=p1");
  });

  test("the list paints while activities are still in flight -- it is never gated on them", async () => {
    const { release } = stubFetch({ holdActivities: true });

    const { getByTestId } = renderProvider("p1");

    // Entries have landed and the list is no longer loading...
    await waitFor(() => expect(getByTestId("entries").textContent).toBe("Blockwork"), WAIT);
    expect(getByTestId("entries-loading").textContent).toBe("false");
    // ...while the activities request has not answered yet. Under the old
    // Promise.all this state was unreachable: rows waited on both.
    expect(getByTestId("activities-loading").textContent).toBe("true");

    release();
    await waitFor(() => expect(getByTestId("activities").textContent).toBe("Blockwork"), WAIT);
  });

  test("a second mount inside the TTL makes no request at all", async () => {
    const first = stubFetch();
    const firstRender = renderProvider("p1");
    await waitFor(() => expect(firstRender.getByTestId("entries").textContent).toBe("Blockwork"), WAIT);
    expect(first.calls.length).toBeGreaterThan(0);
    cleanup();

    // A tab switch: same project, fresh mount, cache still warm.
    const second = stubFetch();
    const { getByTestId } = renderProvider("p1");

    // Painted from cache on the FIRST render -- asserted synchronously, with
    // no waitFor, because a request-then-paint would pass a waitFor too.
    expect(getByTestId("entries").textContent).toBe("Blockwork");
    expect(getByTestId("entries-loading").textContent).toBe("false");
    expect(second.calls).toHaveLength(0);
  });

  test("a different project is a different cache key", async () => {
    const first = stubFetch();
    const firstRender = renderProvider("p1");
    await waitFor(() => expect(firstRender.getByTestId("entries").textContent).toBe("Blockwork"), WAIT);
    cleanup();
    expect(first.calls.length).toBeGreaterThan(0);

    const second = stubFetch();
    const { getByTestId } = renderProvider("p2");
    await waitFor(() => expect(getByTestId("entries").textContent).toBe("Blockwork"), WAIT);

    expect(second.calls.filter((u) => u.includes("projectId=p2")).length).toBeGreaterThan(0);
  });

  test("reload() bypasses the cache -- your own entry is never stale", async () => {
    stubFetch();
    let reload: (() => Promise<void>) | null = null;
    const { getByTestId } = renderProvider("p1", (fn) => {
      reload = fn;
    });
    await waitFor(() => expect(getByTestId("entries").textContent).toBe("Blockwork"), WAIT);

    // Re-stub so the refetch is countable and returns a NEW row -- exactly
    // what a successful write produces.
    const after = stubFetch();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      after.calls.push(url);
      if (url.includes("/api/work-progress/activities")) return jsonRes({ activities: [] });
      return jsonRes({ entries: [{ ...ENTRY, id: "e2", activityName: "Plastering" }] });
    }) as typeof fetch;

    await reload!();

    await waitFor(() => expect(getByTestId("entries").textContent).toBe("Plastering"), WAIT);
    expect(after.calls.filter((u) => u.includes("/api/work-progress?"))).toHaveLength(1);
  });

  test("an entries failure shows the backend's own words, not an empty list", async () => {
    stubFetch({ entriesFail: true });

    const { getByTestId } = renderProvider("p1");

    await waitFor(
      () => expect(getByTestId("entries-error").textContent).toContain("VERIDIAN did not respond in time"),
      WAIT
    );
    expect(getByTestId("entries-error").textContent).toContain("Couldn't load work progress");
    expect(getByTestId("entries").textContent).toBe("");
  });

  test("an activities failure never raises the list's error card", async () => {
    stubFetch({ activitiesFail: true });

    const { getByTestId } = renderProvider("p1");

    await waitFor(() => expect(getByTestId("entries").textContent).toBe("Blockwork"), WAIT);
    await waitFor(() => expect(getByTestId("activities-loading").textContent).toBe("false"), WAIT);

    // Activities are an option source, not the screen's subject.
    expect(getByTestId("entries-error").textContent).toBe("");
    expect(getByTestId("activities").textContent).toBe("");
  });

  test("a failed entries load is never cached as an empty list -- the next mount tries again", async () => {
    // REGRESSION. The cache used to be one { at, entries, activities } record
    // that EITHER load would create. With entries failing and activities
    // succeeding, the activities write minted `entries: []` with a fresh
    // timestamp -- so the next mount inside the TTL short-circuited and
    // painted an empty Work Progress list: no rows, no error card, and no
    // request left to fail. On a real project with entries logged, that reads
    // as "nobody has recorded any progress".
    stubFetch({ entriesFail: true });
    const firstRender = renderProvider("p1");
    // Both halves settle: entries fail, activities succeed.
    await waitFor(() => expect(firstRender.getByTestId("entries-error").textContent).not.toBe(""), WAIT);
    await waitFor(() => expect(firstRender.getByTestId("activities").textContent).toBe("Blockwork"), WAIT);
    cleanup();

    const second = stubFetch();
    const { getByTestId } = renderProvider("p1");

    // It must ASK again rather than serve the failure as an answer.
    await waitFor(() => expect(getByTestId("entries").textContent).toBe("Blockwork"), WAIT);
    expect(second.calls.filter((u) => u.includes("/api/work-progress?"))).toHaveLength(1);
  });

  test("the successful half is still cached when the other half failed", async () => {
    // The converse of the regression above: not caching the failure must not
    // throw away the activities list that genuinely loaded.
    stubFetch({ entriesFail: true });
    const firstRender = renderProvider("p1");
    await waitFor(() => expect(firstRender.getByTestId("activities").textContent).toBe("Blockwork"), WAIT);
    cleanup();

    const second = stubFetch();
    const { getByTestId } = renderProvider("p1");

    // Activities paint from cache on the first render and are not re-asked...
    expect(getByTestId("activities").textContent).toBe("Blockwork");
    await waitFor(() => expect(getByTestId("entries").textContent).toBe("Blockwork"), WAIT);
    expect(second.calls.filter((u) => u.includes("/api/work-progress/activities"))).toHaveLength(0);
    // ...while the half that failed is retried.
    expect(second.calls.filter((u) => u.includes("/api/work-progress?"))).toHaveLength(1);
  });

  test("useWorkProgressData outside the provider fails loudly rather than returning empty data", () => {
    // A silent empty default here would render an empty Work Progress screen
    // on a real project and look like "no entries logged".
    expect(() => render(<Probe />)).toThrow(/must be used inside/);
  });
});
