/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10. The proxy of VERIDIAN's /projects/from-document: what it forwards, what it refuses before forwarding, and what it
// hands back on a refusal. VERIDIAN is a fake; the route and the shared error classifier are the real ones.
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let uploads: Array<{ path: string; form: FormData; options: Record<string, unknown> }> = [];
let reads: string[] = [];
let uploadAnswer: unknown = { state: "received", jobId: "job-1" };
let failure: MockVeridianApiError | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({ requireAuth: async () => mockCtx }));

class MockVeridianApiError extends Error {
  status: number;
  code: string | null = null;
  durationMs = 0;
  ruleCode?: string;
  body?: unknown;
  constructor(message: string, status: number, ruleCode?: string, body?: unknown) {
    super(message);
    this.status = status;
    this.ruleCode = ruleCode;
    this.body = body;
  }
}

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string) => {
    reads.push(path);
    if (failure) throw failure;
    return { jobId: "job-1", state: "ready" };
  },
  callVeridianUpload: async (path: string, form: FormData, options: Record<string, unknown>) => {
    uploads.push({ path, form, options });
    if (failure) throw failure;
    return uploadAnswer;
  },
  VeridianApiError: MockVeridianApiError,
}));

const { POST, GET } = await import("./route");

const signedIn = (): AuthContext => ({ user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "member", response: null }) as AuthContext;

function post(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://test/api/projects/from-document", { method: "POST", body: form }) as unknown as import("next/server").NextRequest;
}
function get(query: string) {
  const url = `http://test/api/projects/from-document${query}`;
  const req = new Request(url) as unknown as import("next/server").NextRequest;
  Object.defineProperty(req, "nextUrl", { value: new URL(url), configurable: true });
  return req;
}
const reset = () => {
  mockCtx = signedIn();
  uploads = [];
  reads = [];
  uploadAnswer = { state: "received", jobId: "job-1" };
  failure = null;
};

describe("POST /api/projects/from-document", () => {
  test("forwards the form to VERIDIAN with ?async=1 for this organisation, and answers 202 with the job", async () => {
    reset();
    const res = await POST(post({ file: new File(["x"], "boq.xlsx"), productId: "prod-1", mode: "prepare", name: "Zoomies" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ state: "received", jobId: "job-1" });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toBe("/projects/from-document?async=1");
    expect(uploads[0].options).toEqual({ organizationId: "org1" });
    expect(uploads[0].form.get("productId")).toBe("prod-1");
    expect(uploads[0].form.get("mode")).toBe("prepare");
    expect((uploads[0].form.get("file") as File).name).toBe("boq.xlsx");
  });

  test("a duplicate answer is 200 with the first project", async () => {
    reset();
    uploadAnswer = { duplicate: true, projectId: "proj-9" };
    const res = await POST(post({ file: new File(["x"], "boq.xlsx"), productId: "prod-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ duplicate: true, projectId: "proj-9" });
  });

  test("refuses a request with no file or no product before VERIDIAN is called", async () => {
    reset();
    const noFile = await POST(post({ productId: "prod-1" }));
    expect(noFile.status).toBe(400);
    expect((await noFile.json()).code).toBe("no_file");
    const noProduct = await POST(post({ file: new File(["x"], "boq.xlsx"), productId: "  " }));
    expect(noProduct.status).toBe(400);
    expect((await noProduct.json()).code).toBe("product_required");
    expect(uploads).toHaveLength(0);
  });

  test("a signed-out request is answered by the guard and forwards nothing", async () => {
    reset();
    mockCtx = { response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) } as unknown as AuthContext;
    const res = await POST(post({ file: new File(["x"], "boq.xlsx"), productId: "prod-1" }));
    expect(res.status).toBe(401);
    expect(uploads).toHaveLength(0);
  });

  test("a refusal keeps the sentence and status of VERIDIAN and adds its own code and issue list", async () => {
    reset();
    failure = new MockVeridianApiError("The lines add up to less than the file prints, so nothing was created.", 422, "extraction_total_mismatch", { issues: ["difference 207800", 5] });
    const res = await POST(post({ file: new File(["x"], "boq.xlsx"), productId: "prod-1" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("The lines add up to less than the file prints, so nothing was created.");
    expect(body.upstreamCode).toBe("extraction_total_mismatch");
    expect(body.issues).toEqual(["difference 207800"]);
  });
});

describe("GET /api/projects/from-document", () => {
  test("reads a job by the sha256 of the file, lower-cased", async () => {
    reset();
    const res = await GET(get(`?sha256=${"A".repeat(64)}`));
    expect(res.status).toBe(200);
    expect(reads).toEqual([`/projects/from-document?sha256=${"a".repeat(64)}`]);
  });

  test("reads a job by its id, encoded", async () => {
    reset();
    await GET(get("?jobId=job-1"));
    expect(reads).toEqual(["/projects/from-document?jobId=job-1"]);
  });

  test("refuses a request that names neither, or names a malformed hash, before VERIDIAN is called", async () => {
    reset();
    expect((await GET(get(""))).status).toBe(400);
    expect((await GET(get("?sha256=abc"))).status).toBe(400);
    expect((await GET(get("?jobId=../../etc"))).status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  test("a job that does not exist is the 404 of VERIDIAN with its own code", async () => {
    reset();
    failure = new MockVeridianApiError("No such extraction job", 404, "job_not_found");
    const res = await GET(get(`?sha256=${"b".repeat(64)}`));
    expect(res.status).toBe(404);
    expect((await res.json()).upstreamCode).toBe("job_not_found");
  });
});
