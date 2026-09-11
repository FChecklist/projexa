/// <reference types="bun-types" />
// Tests what the composer is allowed to offer as pills -- fetchCapabilityTree()
// and the pure mergeChainTrees() it delegates to. Everything else in
// veri-chat-context.tsx (the state machine) is the shared veridian-ui-kit
// factory, already covered by that package's own tests.
//
// R-80/R-81: the assertions below are the automated statement of "exactly one
// chain path is offered, and it is the one that dispatches end to end." The
// SHOW_UNDISPATCHABLE_MODULE_CHAINS-on cases are kept and tested too, so the
// flag is a live, verified switch rather than a comment promising reversibility.
import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import {
  fetchCapabilityTree,
  fetchJsonNodes,
  mergeChainTrees,
  SHOW_UNDISPATCHABLE_MODULE_CHAINS,
  CONSTRUCTION_CHAIN_MODE_KEY,
  type CapabilityNode,
} from "./veri-chat-context";
import { getShellSnapshot, loadShell, resetShellStore } from "@/lib/shell-store";

const originalFetch = global.fetch;

beforeEach(() => {
  resetShellStore();
});

afterEach(() => {
  global.fetch = originalFetch;
  resetShellStore();
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const constructionNode: CapabilityNode = {
  key: CONSTRUCTION_CHAIN_MODE_KEY,
  label: "Construction Intelligence",
  leaf: false,
  children: [{ key: "budget", label: "Budget status", leaf: true, deterministic: true, codeReference: "get_construction_budget_status" }],
};

const moduleChainNodes: CapabilityNode[] = [
  { key: "grc", label: "VERI GRC AI", leaf: false, children: [{ key: "grc_wired", label: "Wired", leaf: true, deterministic: true }] },
  { key: "erp", label: "VERI ERP", leaf: false, children: [{ key: "erp_wired", label: "Wired", leaf: true, deterministic: true }] },
];

describe("R-81: the composer offers only chains PROJEXA can dispatch", () => {
  test("the flag ships OFF -- the undispatchable VERIDIAN module chain is hidden by default", () => {
    expect(SHOW_UNDISPATCHABLE_MODULE_CHAINS).toBe(false);
  });

  test("mergeChainTrees drops the whole module chain when it is hidden, however wired its leaves claim to be", () => {
    // Every node here carries deterministic:true -- i.e. VERIDIAN can run
    // them. PROJEXA still cannot dispatch them, which is the distinction that
    // left R-81 open after the leaf-level prune alone.
    const tree = mergeChainTrees([constructionNode], moduleChainNodes, false);
    expect(tree.map((n) => n.key)).toEqual([CONSTRUCTION_CHAIN_MODE_KEY]);
  });

  test("fetchCapabilityTree returns only the construction chain, and does not even call /api/module-chain", async () => {
    const called: string[] = [];
    global.fetch = mock(async (url: string) => {
      called.push(url);
      if (url === "/api/capability-tree") return jsonResponse({ nodes: [constructionNode] });
      return jsonResponse({ nodes: moduleChainNodes });
    }) as unknown as typeof fetch;

    const tree = await fetchCapabilityTree();
    expect(tree.map((n) => n.key)).toEqual([CONSTRUCTION_CHAIN_MODE_KEY]);
    // Not merely filtered out afterwards: never requested. /api/module-chain
    // is one of the routes named in the R46 production incident as hanging
    // until Vercel's 300s cap, so not fetching what is hidden is real.
    expect(called).toEqual(["/api/capability-tree"]);
  });

  test("R-80: the one surviving chain is the dispatchable one, and it keeps its real codeReference leaf", async () => {
    global.fetch = mock(async () => jsonResponse({ nodes: [constructionNode] })) as unknown as typeof fetch;

    const tree = await fetchCapabilityTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].key).toBe(CONSTRUCTION_CHAIN_MODE_KEY);
    // A pill path that resolves to a codeReference is what /api/assistant
    // dispatches -- an offered chain that bottomed out in a leaf with no
    // codeReference would be the dead end R-80 exists to rule out.
    expect(tree[0].children?.[0]?.codeReference).toBe("get_construction_budget_status");
  });

  test("a failed construction fetch yields no pills at all rather than throwing", async () => {
    global.fetch = mock(async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;

    expect(await fetchCapabilityTree()).toEqual([]);
  });

  test("a non-ok construction response contributes no nodes instead of throwing", async () => {
    global.fetch = mock(async () => jsonResponse({ error: "no organisation" }, false)) as unknown as typeof fetch;
    expect(await fetchCapabilityTree()).toEqual([]);
  });
});

// The module chain is HIDDEN, not deleted. These cases lock in what comes
// back when cross-module dispatch ships and the flag flips on -- including
// the leaf-level prune, which stays the second line of defence.
describe("SHOW_UNDISPATCHABLE_MODULE_CHAINS on (reversibility)", () => {
  test("concatenates the construction tree and the module-chain tree, construction first", () => {
    const tree = mergeChainTrees([constructionNode], moduleChainNodes, true);
    expect(tree.map((n) => n.key)).toEqual([CONSTRUCTION_CHAIN_MODE_KEY, "grc", "erp"]);
  });

  test("one source being empty doesn't take the other down", () => {
    expect(mergeChainTrees([], moduleChainNodes, true).map((n) => n.key)).toEqual(["grc", "erp"]);
    expect(mergeChainTrees([constructionNode], [], true).map((n) => n.key)).toEqual([CONSTRUCTION_CHAIN_MODE_KEY]);
  });

  // R38 (R-81/TC-82): a module-chain leaf with no real codeReference
  // (deterministic !== true) must never reach the composer -- hidden, not
  // wired. A branch that loses every leaf to this must itself disappear (an
  // empty branch pill is its own dead end), recursively.
  test("hides non-deterministic leaves and any branch left with zero children as a result", () => {
    const tree = mergeChainTrees(
      [],
      [
        {
          key: "erp", label: "VERI ERP", leaf: false,
          children: [
            { key: "erp_wired", label: "Wired Leaf", leaf: true, deterministic: true },
            { key: "erp_unwired", label: "Unwired Leaf", leaf: true, deterministic: false },
            { key: "erp_undeclared", label: "Undeclared Leaf", leaf: true },
          ],
        },
        {
          key: "grc", label: "VERI GRC AI", leaf: false,
          children: [{ key: "grc_unwired", label: "Only Unwired", leaf: true, deterministic: false }],
        },
        {
          key: "sales", label: "Sales", leaf: false,
          children: [
            {
              key: "sales_sub", label: "Sub-branch", leaf: false,
              children: [{ key: "sales_sub_wired", label: "Wired", leaf: true, deterministic: true }],
            },
          ],
        },
      ],
      true
    );

    // "grc" (only unwired leaf) is gone entirely; "erp" survives with only
    // its wired leaf; "sales" survives with its nested sub-branch intact.
    expect(tree.map((n) => n.key)).toEqual(["erp", "sales"]);
    expect(tree.find((n) => n.key === "erp")!.children?.map((c) => c.key)).toEqual(["erp_wired"]);
    expect(tree.find((n) => n.key === "sales")!.children?.[0]?.children?.map((c) => c.key)).toEqual(["sales_sub_wired"]);
  });
});

describe("fetchJsonNodes", () => {
  test("defaults to an empty array when `nodes` is missing from the response", async () => {
    global.fetch = mock(async () => jsonResponse({})) as unknown as typeof fetch;
    expect(await fetchJsonNodes("/api/whatever")).toEqual([]);
  });
});

// F-034/F-036: a single page mount used to fetch the identical construction
// tree TWICE, concurrently -- once inside /api/shell's own fan-out (F-21/
// R-236), once again here, unconditionally. A real Playwright trace showed 5
// concurrent GETs within 626ms of a /scope/new mount from this and other
// top-level reads, contributing to 7-9+ concurrent withTenantContext
// connections against ct's 5-connection pool and a real 504.
//
// shellPayload()/mockShellFetch() below stand in for a real GET /api/shell
// response -- minimal, but real enough for readJsonWithRetry() (shell-store's
// own fetch wrapper) to accept it, matching shell-store.test.ts's own
// payload() convention.
function shellPayload(overrides: Record<string, unknown> = {}) {
  return {
    organization: { id: "o1", name: "Skyline Builders", slug: "skyline", country: "IN" },
    role: "member",
    email: "a@example.com",
    userId: "u1",
    projects: [],
    notifications: [],
    unreadCount: 0,
    pillUsage: [],
    recentChains: [],
    history: [],
    isNewUser: false,
    capabilityTree: [constructionNode],
    currencies: [],
    vendors: [],
    fetchedAt: Date.now(),
    errors: {},
    ...overrides,
  };
}

describe("F-034/F-036: fetchCapabilityTree does not duplicate the shell's own /api/shell fetch", () => {
  test("VERIFY THE BUG WOULD BE CAUGHT: with no shell data at all, fetchCapabilityTree falls back to a direct fetch (baseline -- this path is unchanged by the fix)", async () => {
    const called: string[] = [];
    global.fetch = mock(async (url: string) => {
      called.push(url);
      return jsonResponse({ nodes: [constructionNode] });
    }) as unknown as typeof fetch;

    const tree = await fetchCapabilityTree();
    expect(tree.map((n) => n.key)).toEqual([CONSTRUCTION_CHAIN_MODE_KEY]);
    expect(called).toEqual(["/api/capability-tree"]);
  });

  test("a FRESH shell (already populated by /api/shell) is used directly -- zero calls to /api/capability-tree", async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify(shellPayload()), { status: 200, headers: { "content-type": "application/json" } })
    ) as unknown as typeof fetch;
    await loadShell();
    expect(getShellSnapshot().data?.capabilityTree).toEqual([constructionNode]);

    const called: string[] = [];
    global.fetch = mock(async (url: string) => {
      called.push(url);
      throw new Error("fetchCapabilityTree must not have called this at all");
    }) as unknown as typeof fetch;

    const tree = await fetchCapabilityTree();
    expect(tree.map((n) => n.key)).toEqual([CONSTRUCTION_CHAIN_MODE_KEY]);
    expect(called).toEqual([]);
  });

  test("an IN-FLIGHT shell load (M24Shell's own /api/shell call, already started) is JOINED -- fetchCapabilityTree waits on it instead of firing a second request", async () => {
    let shellCalls = 0;
    let resolveShell!: (body: unknown) => void;
    global.fetch = mock(async () => {
      shellCalls += 1;
      return new Promise<Response>((resolve) => {
        resolveShell = (body: unknown) =>
          resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
      });
    }) as unknown as typeof fetch;

    // Simulates M24Shell's useShell() effect firing first on mount (React
    // commits a descendant's effects before its ancestor's -- M24Shell sits
    // BELOW VeriChatProvider in app/(app)/layout.tsx, see that file's own
    // header comment) and starting the ONE shell request before
    // fetchCapabilityTree() runs.
    const shellLoadPromise = loadShell();

    const treePromise = fetchCapabilityTree();
    // Let the join's own microtasks (getInFlightShellLoad -> await it) run
    // before the shell request resolves, proving fetchCapabilityTree is
    // actually waiting on the SAME request rather than having already fired
    // (and possibly resolved) its own.
    await Promise.resolve();
    expect(shellCalls).toBe(1);

    resolveShell(shellPayload());
    await shellLoadPromise;
    const tree = await treePromise;

    expect(tree.map((n) => n.key)).toEqual([CONSTRUCTION_CHAIN_MODE_KEY]);
    // The whole point: ONE real network call total for this mount, not two.
    expect(shellCalls).toBe(1);
  });
});
