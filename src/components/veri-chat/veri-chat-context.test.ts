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
        return jsonResponse({ nodes: [{ key: "grc", label: "VERI GRC AI", leaf: false, children: [] }, { key: "erp", label: "VERI ERP", leaf: false, children: [] }] });
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
      return jsonResponse({ nodes: [{ key: "grc", label: "VERI GRC AI", leaf: false, children: [] }] });
    }) as unknown as typeof fetch;

    const tree = await fetchCapabilityTree();
    expect(tree.map((n) => n.key)).toEqual(["grc"]);
  });
});

describe("fetchJsonNodes", () => {
  test("defaults to an empty array when `nodes` is missing from the response", async () => {
    global.fetch = mock(async () => jsonResponse({})) as unknown as typeof fetch;
    expect(await fetchJsonNodes("/api/whatever")).toEqual([]);
  });
});
