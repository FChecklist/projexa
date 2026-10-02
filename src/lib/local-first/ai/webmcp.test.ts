// WebMCP registration with a fake navigator.modelContext: both draft shapes, silence when absent, and the tools really
// calling window.projexa.ai (with refusals coming back as isError, in plain words).

import { describe, expect, test } from "bun:test";
import { TOOLS } from "./tools";
import { registerWebMcp, type ModelContextLike, type WebMcpTool } from "./webmcp";
import { makeRig } from "./__fixtures__/ai-rig";

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe("registerWebMcp", () => {
  test("registerTool shape: every tool registered with a schema; unregister removes them", async () => {
    const { surface } = await makeRig();
    const registered = new Map<string, WebMcpTool>();
    const mc: ModelContextLike = {
      registerTool: (t) => { registered.set(t.name, t); return { unregister: () => registered.delete(t.name) }; },
    };
    const r = registerWebMcp({ modelContext: mc }, surface.api);
    expect(r.registered).toEqual(TOOLS.map((t) => t.name));
    expect([...registered.keys()]).toEqual(TOOLS.map((t) => t.name));
    for (const t of registered.values()) {
      expect(t.inputSchema.type).toBe("object");
      expect(typeof t.description).toBe("string");
    }
    expect(registered.get("projexa_list")!.annotations?.readOnlyHint).toBe(true);
    expect(registered.get("projexa_create")!.annotations?.readOnlyHint).toBe(false);
    r.unregister();
    expect(registered.size).toBe(0);
  });

  test("provideContext shape is used when registerTool is absent", async () => {
    const { surface } = await makeRig();
    let provided: WebMcpTool[] | null = null;
    const r = registerWebMcp({ modelContext: { provideContext: ({ tools }) => { provided = tools; } } }, surface.api);
    expect(r.registered.length).toBe(TOOLS.length);
    expect(provided!.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    r.unregister();
    expect(provided).toEqual([]);
  });

  test("silent when the browser has no WebMCP (or a broken one)", async () => {
    const { surface } = await makeRig();
    expect(registerWebMcp({}, surface.api).registered).toEqual([]);
    expect(registerWebMcp(null, surface.api).registered).toEqual([]);
    expect(registerWebMcp({ modelContext: { registerTool: () => { throw new Error("nope"); } } }, surface.api).registered).toEqual([]);
  });

  test("a scripted agent with no setup lists projects, lists tasks and creates a task", async () => {
    const { surface, outbox } = await makeRig();
    const tools = new Map<string, WebMcpTool>();
    registerWebMcp({ modelContext: { registerTool: (t) => { tools.set(t.name, t); } } }, surface.api);
    const manifest = parse(await tools.get("projexa_manifest")!.execute({}));
    expect(manifest.projects.map((p: { name: string }) => p.name)).toEqual(["Harbor View", "Cedar Villa"]);
    const tasks = parse(await tools.get("projexa_list")!.execute({ kind: "tasks", projectId: manifest.projects[0].id }));
    expect(tasks.items.map((t: { id: string }) => t.id)).toEqual(["t1"]);
    const created = await tools.get("projexa_create")!.execute({ functionId: "create_schedule_task", params: { projectId: "p1", title: "Order rebar", startDate: "2026-10-05" } });
    expect(created.isError).toBeUndefined();
    expect(parse(created).status).toBe("queued");
    const [op] = await outbox.listPending();
    expect(op).toMatchObject({ functionId: "create_schedule_task", params: { projectId: "p1", title: "Order rebar", startDate: "2026-10-05" }, creates: { kind: "tasks" } });
    expect((await surface.api.list("tasks", { projectId: "p1" })).items.map((t) => t.data)).toContainEqual(expect.objectContaining({ title: "Order rebar" }));
  });

  test("a refusal comes back as isError with the plain-words message", async () => {
    const { surface } = await makeRig({ role: "viewer" });
    const tools = new Map<string, WebMcpTool>();
    registerWebMcp({ modelContext: { registerTool: (t) => { tools.set(t.name, t); } } }, surface.api);
    const r = await tools.get("projexa_update")!.execute({ functionId: "update_task", record: { kind: "tasks", id: "t1" }, params: { projectId: "p1", issueId: "t1", title: "x" } });
    expect(r.isError).toBe(true);
    expect(parse(r)).toEqual({ code: "ROLE_TOO_LOW", error: expect.stringContaining("Your role (viewer) cannot do") });
  });
});
