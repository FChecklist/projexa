// Tests for scripts/error-triage/*: run the real scripts as child processes
// against a local fake error-log server (no network, no real key).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PULL = path.resolve(import.meta.dir, "../../scripts/error-triage/pull-errors.mjs");
const FIX = path.resolve(import.meta.dir, "../../scripts/error-triage/record-fix.mjs");

type Req = { method: string; url: string; auth: string | undefined; body: any };
let server: Server;
let base = "";
let seen: Req[] = [];
let mode: "ok" | "401" = "ok";
let work = "";
let veridian = "";

const issue = (o: any) => ({
  id: "i-1", title: "Crash", status: "open", occurrences: 1, severity: "high", project_ids: ["p1"], routes: [],
  first_seen_at: "2026-10-01", last_seen_at: "2026-10-02", reopened_count: 0,
  sample: { message: "boom", stack: "Error: boom\n at x", route: "/projects/abc/tasks", breadcrumbs: ["clicked Save"], context: {} },
  ...o,
});
const ISSUES = [
  issue({ id: "low-1", title: "Low thing", severity: "low", occurrences: 99 }),
  issue({ id: "hi-few", title: "High few", severity: "high", occurrences: 2 }),
  issue({
    id: "hi-many", title: "High many", severity: "high", occurrences: 40, reopened_count: 1,
    sample: {
      message: "Failed to load", stack: "TypeError: x is undefined", route: "/projects/abc/tasks", http_method: "GET",
      api_path: "/api/v1/projexa/tasks/77", http_status: 500, request_id: "req-9",
      breadcrumbs: [{ ts: "10:00", type: "click", label: "Open tasks" }, "typed a name"],
      context: { device: "Pixel 7", viewport: "412x915" },
    },
  }),
];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
      if (mode === "401") { res.statusCode = 401; return res.end("{}"); }
      const u = new URL(req.url!, "http://x");
      res.setHeader("content-type", "application/json");
      if (req.method === "PATCH") return res.end(JSON.stringify({ data: { issue: { id: u.pathname.split("/").pop(), ...JSON.parse(raw) } } }));
      if (u.pathname.endsWith("/issues")) {
        const st = u.searchParams.get("status");
        return res.end(JSON.stringify({ data: { issues: st === "open" ? ISSUES.slice(0, 2).concat(ISSUES[2]) : [] } }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "triage-"));
  fs.mkdirSync(path.join(work, "src/app/(app)/projects/[id]/tasks"), { recursive: true });
  fs.writeFileSync(path.join(work, "src/app/(app)/projects/[id]/tasks/page.tsx"), "export default 1");
  veridian = fs.mkdtempSync(path.join(os.tmpdir(), "veridian-"));
  fs.mkdirSync(path.join(veridian, "src/app/api/v1/projexa/tasks/[id]"), { recursive: true });
  fs.writeFileSync(path.join(veridian, "src/app/api/v1/projexa/tasks/[id]/route.ts"), "export {}");
});
afterAll(() => {
  server.close();
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(veridian, { recursive: true, force: true });
});

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const p = spawn(process.execPath.includes("bun") ? "node" : process.execPath, [script, ...args], {
      cwd: work, env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env },
    });
    let out = "", err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (code) => resolve({ code: code ?? -1, out, err }));
  });
}
const good = () => ({ VERIDIAN_API_KEY: "k-test", VERIDIAN_BASE_URL: base });

describe("pull-errors", () => {
  test("groups, sorts by severity then occurrences, adds where-to-look hints", async () => {
    seen = []; mode = "ok";
    const f = path.join(work, "q.md");
    const r = await run(PULL, ["--out", f], { ...good(), VERIDIAN_REPO_PATH: veridian });
    expect(r.code).toBe(0);
    const md = fs.readFileSync(f, "utf8");
    expect(md.indexOf("High many")).toBeLessThan(md.indexOf("High few"));
    expect(md.indexOf("High few")).toBeLessThan(md.indexOf("Low thing"));
    expect(md).toContain("## 1. High many");
    expect(md).toContain("came back 1 time(s)");
    expect(md).toContain("GET /api/v1/projexa/tasks/77 -> status 500   Request id: req-9");
    expect(md).toContain("1. 10:00 [click] Open tasks");
    expect(md).toContain("Pixel 7");
    expect(md).toContain("`src/app/(app)/projects/[id]/tasks/page.tsx`");
    expect(md).toContain("src/app/api/v1/projexa/tasks/[id]/route.ts");
    expect(md).toContain("found in " + veridian);
    expect(seen.every((s) => s.auth === "Bearer k-test")).toBe(true);
    expect(seen.map((s) => new URL(s.url, base).searchParams.get("status")).sort()).toEqual(["open", "reopened"]);
  });

  test("--limit and --project are passed through", async () => {
    seen = [];
    const f = path.join(work, "q2.md");
    const r = await run(PULL, ["--out", f, "--limit", "1", "--project", "p9"], good());
    expect(r.code).toBe(0);
    const q = new URL(seen[0].url, base).searchParams;
    expect(q.get("limit")).toBe("1");
    expect(q.get("projectId")).toBe("p9");
    expect(fs.readFileSync(f, "utf8")).toContain("1 open or reopened");
  });

  test("plain-words failures: missing key, 401, network", async () => {
    let r = await run(PULL, [], { VERIDIAN_BASE_URL: base });
    expect(r.code).toBe(1);
    expect(r.err).toContain("API key is missing");
    mode = "401";
    r = await run(PULL, [], good());
    expect(r.code).toBe(1);
    expect(r.err).toContain("refused the API key");
    mode = "ok";
    r = await run(PULL, [], { VERIDIAN_API_KEY: "k", VERIDIAN_BASE_URL: "http://127.0.0.1:1" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("Could not reach the error log");
  });
});

describe("record-fix", () => {
  test("PATCHes status fixed with summary, files, commit and prints the stored record", async () => {
    seen = [];
    const r = await run(FIX, ["--issue", "abc", "--summary", "Guarded the empty list", "--file", "src/a.ts", "--change", "null check", "--file", "src/b.ts", "--change", "test", "--commit", "deadbeef"], good());
    expect(r.code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("PATCH");
    expect(seen[0].url).toContain("/client-logs/issues/abc");
    expect(seen[0].body).toEqual({
      status: "fixed", fix_summary: "Guarded the empty list", fix_commit: "deadbeef", fixed_by: "claude-code",
      fix_files: [{ path: "src/a.ts", change: "null check" }, { path: "src/b.ts", change: "test" }],
    });
    expect(r.out).toContain("Stored on issue abc");
    expect(r.out).toContain("Guarded the empty list");
  });

  test("refuses to mark fixed without a summary or without a file (nothing is sent)", async () => {
    seen = [];
    let r = await run(FIX, ["--issue", "abc", "--file", "src/a.ts", "--change", "x"], good());
    expect(r.code).toBe(1);
    expect(r.err).toContain("without a plain-English summary");
    r = await run(FIX, ["--issue", "abc", "--summary", "s"], good());
    expect(r.code).toBe(1);
    expect(r.err).toContain("without at least one changed file");
    expect(seen).toHaveLength(0);
  });

  test("--ignore needs a reason and sends status ignored", async () => {
    seen = [];
    let r = await run(FIX, ["--ignore", "abc"], good());
    expect(r.code).toBe(1);
    expect(r.err).toContain("needs a reason");
    r = await run(FIX, ["--ignore", "abc", "--reason", "bot traffic"], good());
    expect(r.code).toBe(0);
    expect(seen[0].body.status).toBe("ignored");
    expect(seen[0].body.fix_summary).toBe("bot traffic");
  });

  test("--dry-run prints the request and sends nothing, even without a key", async () => {
    seen = [];
    const r = await run(FIX, ["--issue", "abc", "--summary", "s", "--file", "f.ts", "--change", "c", "--dry-run"], { VERIDIAN_BASE_URL: base });
    expect(r.code).toBe(0);
    expect(r.out).toContain("DRY RUN");
    expect(r.out).toContain('"status": "fixed"');
    expect(seen).toHaveLength(0);
  });

  test("plain-words failures: missing key, 401", async () => {
    const a = ["--issue", "abc", "--summary", "s", "--file", "f.ts", "--change", "c"];
    let r = await run(FIX, a, { VERIDIAN_BASE_URL: base });
    expect(r.err).toContain("API key is missing");
    mode = "401";
    r = await run(FIX, a, good());
    expect(r.err).toContain("refused the API key");
    mode = "ok";
  });
});
