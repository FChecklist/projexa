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
import { describe, test, expect, mock, afterEach } from "bun:test";
import {
  fetchCapabilityTree,
  fetchJsonNodes,
  mergeChainTrees,
  SHOW_UNDISPATCHABLE_MODULE_CHAINS,
  CONSTRUCTION_CHAIN_MODE_KEY,
  type CapabilityNode,
} from "./veri-chat-context";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
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
