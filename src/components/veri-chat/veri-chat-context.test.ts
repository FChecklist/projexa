/// <reference types="bun-types" />
// Tests fetchCapabilityTree()'s merge of PROJEXA's own construction tree
// (/api/capability-tree, unchanged) with the new full VERIDIAN module chain
// (/api/module-chain) -- the one piece of real logic this task adds to
// veri-chat-context.tsx. Everything else (the state machine) is the shared
// veridian-ui-kit factory, already covered by that package's own tests.
import { describe, test, expect, mock, afterEach } from "bun:test";
import { fetchCapabilityTree, fetchJsonNodes, CONSTRUCTION_CHAIN_MODE_KEY } from "./veri-chat-context";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("fetchCapabilityTree", () => {
  test("concatenates the construction tree and the module-chain tree, construction first", async () => {
    global.fetch = mock(async (url: string) => {
      if (url === "/api/capability-tree") {
        return jsonResponse({ nodes: [{ key: CONSTRUCTION_CHAIN_MODE_KEY, label: "Construction Intelligence", leaf: false, children: [] }] });
      }
      if (url === "/api/module-chain") {
        return jsonResponse({
          nodes: [
            { key: "grc", label: "VERI GRC AI", leaf: false, children: [{ key: "grc_wired", label: "Wired", leaf: true, deterministic: true }] },
            { key: "erp", label: "VERI ERP", leaf: false, children: [{ key: "erp_wired", label: "Wired", leaf: true, deterministic: true }] },
          ],
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const tree = await fetchCapabilityTree();
    expect(tree.map((n) => n.key)).toEqual([CONSTRUCTION_CHAIN_MODE_KEY, "grc", "erp"]);
  });

  test("a failed module-chain fetch still returns the construction tree (one source failing doesn't take the other down)", async () => {
    global.fetch = mock(async (url: string) => {
      if (url === "/api/capability-tree") {
        return jsonResponse({ nodes: [{ key: CONSTRUCTION_CHAIN_MODE_KEY, label: "Construction Intelligence", leaf: false, children: [] }] });
      }
      throw new Error("network error");
    }) as unknown as typeof fetch;

    const tree = await fetchCapabilityTree();
    expect(tree.map((n) => n.key)).toEqual([CONSTRUCTION_CHAIN_MODE_KEY]);
  });

  test("a non-ok response from either endpoint contributes no nodes instead of throwing", async () => {
    global.fetch = mock(async (url: string) => {
      if (url === "/api/capability-tree") return jsonResponse({ error: "no organisation" }, false);
      return jsonResponse({ nodes: [{ key: "grc", label: "VERI GRC AI", leaf: false, children: [{ key: "grc_wired", label: "Wired", leaf: true, deterministic: true }] }] });
    }) as unknown as typeof fetch;

    const tree = await fetchCapabilityTree();
    expect(tree.map((n) => n.key)).toEqual(["grc"]);
  });

  // R38 (R-81/TC-82, Master v5 G-5/P-9): a module-chain leaf with no real
  // codeReference (deterministic !== true) must never reach the composer --
  // hidden, not wired. A branch that loses every leaf to this must itself
  // disappear (an empty branch pill is its own dead end), recursively.
  test("hides non-deterministic leaves and any branch left with zero children as a result", async () => {
    global.fetch = mock(async (url: string) => {
      if (url === "/api/capability-tree") return jsonResponse({ nodes: [] });
      if (url === "/api/module-chain") {
        return jsonResponse({
          nodes: [
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
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const tree = await fetchCapabilityTree();
    // "grc" (only unwired leaf) is gone entirely; "erp" survives with only
    // its wired leaf; "sales" survives with its nested sub-branch intact.
    expect(tree.map((n) => n.key)).toEqual(["erp", "sales"]);
    const erp = tree.find((n) => n.key === "erp")!;
    expect(erp.children?.map((c) => c.key)).toEqual(["erp_wired"]);
    const sales = tree.find((n) => n.key === "sales")!;
    expect(sales.children?.[0]?.children?.map((c) => c.key)).toEqual(["sales_sub_wired"]);
  });
});

describe("fetchJsonNodes", () => {
  test("defaults to an empty array when `nodes` is missing from the response", async () => {
    global.fetch = mock(async () => jsonResponse({})) as unknown as typeof fetch;
    expect(await fetchJsonNodes("/api/whatever")).toEqual([]);
  });
});
