// LOCAL-FIRST browser AI: registers PROJEXA's tools with the browser's own AI through WebMCP (navigator.modelContext),
// when the browser has it (requirement R11: "the page registers its tools with the browser AI ... nothing for the user
// to set up").
//
// WebMCP is an early, experimental browser API (W3C Web Machine Learning CG draft): some browsers and extensions provide
// navigator.modelContext, most do not yet. It is FEATURE-DETECTED and SILENT when absent: no error, no console noise,
// the other doors (window.projexa.ai, /llms.txt, the in-page manual, the accessible UI) still work.
//
// Two shapes of the draft exist in the wild, both handled:
//   registerTool({name, description, inputSchema, execute})  -> returns {unregister()} (or nothing)   [preferred]
//   provideContext({tools:[...]})                             -> replaces the page's whole tool set
// Each tool calls the same window.projexa.ai method (tools.ts is the one list). Results go back as MCP content:
// {content:[{type:"text", text:<JSON>}]}; a refusal comes back with isError:true and the plain-words message.

import type { ProjexaAi } from "./api";
import { TOOLS, type ToolSpec } from "./tools";

export type WebMcpToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export type WebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<WebMcpToolResult>;
};

export type ModelContextLike = {
  registerTool?: (tool: WebMcpTool) => unknown;
  unregisterTool?: (name: string) => unknown;
  provideContext?: (context: { tools: WebMcpTool[] }) => unknown;
  clearContext?: () => unknown;
};

const ok = (value: unknown): WebMcpToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const fail = (err: unknown): WebMcpToolResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : String(err), code: (err as { code?: unknown })?.code ?? "ERROR" }) }],
});

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown) => (typeof v === "string" ? v : "");

function call(api: ProjexaAi, spec: ToolSpec, input: Record<string, unknown>): Promise<unknown> {
  switch (spec.method) {
    case "manifest": return api.manifest();
    case "manual": return api.manual();
    case "list": return api.list(s(input.kind), { projectId: typeof input.projectId === "string" ? input.projectId : undefined, filter: obj(input.filter), limit: typeof input.limit === "number" ? input.limit : undefined });
    case "get": return api.get(s(input.kind), s(input.id));
    case "search": return api.search(s(input.text), { projectId: typeof input.projectId === "string" ? input.projectId : undefined });
    case "create": return api.create(s(input.functionId), obj(input.params));
    case "update": return api.update(s(input.functionId), { kind: s(obj(input.record).kind), id: s(obj(input.record).id) }, obj(input.params));
    case "delete": return api.delete(s(input.functionId), { kind: s(obj(input.record).kind), id: s(obj(input.record).id) }, obj(input.params));
  }
}

/** The WebMCP tool objects for an API (exported for the tests and the manual). */
export function webMcpTools(api: ProjexaAi): WebMcpTool[] {
  return TOOLS.map((spec) => ({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: { readOnlyHint: spec.readOnly },
    execute: async (input) => {
      try {
        return ok(await call(api, spec, obj(input)));
      } catch (err) {
        return fail(err);
      }
    },
  }));
}

/**
 * Registers the tools when `nav.modelContext` exists. Returns an unregister function (a no-op when nothing was
 * registered). Never throws: a browser whose draft API behaves differently simply does not get the tools.
 */
export function registerWebMcp(nav: { modelContext?: ModelContextLike } | undefined | null, api: ProjexaAi): { registered: string[]; unregister: () => void } {
  const mc = nav?.modelContext;
  const none = { registered: [], unregister: () => {} };
  if (!mc || typeof mc !== "object") return none;
  const tools = webMcpTools(api);
  try {
    if (typeof mc.registerTool === "function") {
      const handles = tools.map((t) => mc.registerTool!(t) as { unregister?: () => void } | undefined);
      return {
        registered: tools.map((t) => t.name),
        unregister: () => {
          handles.forEach((h, i) => {
            try {
              if (h && typeof h.unregister === "function") h.unregister();
              else if (typeof mc.unregisterTool === "function") mc.unregisterTool(tools[i].name);
            } catch { /* the page is going away; nothing to do */ }
          });
        },
      };
    }
    if (typeof mc.provideContext === "function") {
      mc.provideContext({ tools });
      return {
        registered: tools.map((t) => t.name),
        unregister: () => {
          try {
            if (typeof mc.clearContext === "function") mc.clearContext();
            else mc.provideContext!({ tools: [] });
          } catch { /* nothing to do */ }
        },
      };
    }
  } catch {
    return none;
  }
  return none;
}
