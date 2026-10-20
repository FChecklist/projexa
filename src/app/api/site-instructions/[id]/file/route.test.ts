/// <reference types="bun-types" />
// R-C14: "Add file" on a site instruction that already exists (the laptop-first form cannot carry a file). Runs the real route handler;
// only auth and the upstream upload are replaced. Proves: the file is written to the documents endpoint linked to THIS instruction,
// a wrong file type / missing file is refused before anything is sent, a role below PM is refused, and the server's refusal passes through.
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let uploads: Array<{ path: string; entries: Record<string, unknown>; options: Record<string, unknown> }>;
let upstreamError: Error | null;

const realAuthGuard = await import("@/lib/supabase/auth-guard");
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuth: async () => mockCtx,
}));

class FakeVeridianApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
mock.module("@/lib/veridian-client", () => ({
  callVeridianUpload: async (path: string, form: FormData, options: Record<string, unknown>) => {
    uploads.push({ path, entries: Object.fromEntries(form.entries()), options });
    if (upstreamError) throw upstreamError;
    return { id: "doc1" };
  },
  VeridianApiError: FakeVeridianApiError,
}));
const { POST } = await import("./route");

const ctx = (role: string): AuthContext => ({ user: { id: "u1", email: "pm@example.com" }, organizationId: "org1", role, response: null }) as unknown as AuthContext;
const call = (name: string, bytes = "x", type = "application/pdf") => {
  const form = new FormData();
  if (name) form.set("file", new File([bytes], name, { type }));
  return POST(new NextRequest("http://test/api/site-instructions/si1/file", { method: "POST", body: form }), { params: Promise.resolve({ id: "si1" }) });
};

describe("POST /api/site-instructions/[id]/file", () => {
  beforeEach(() => { uploads = []; upstreamError = null; mockCtx = ctx("pm"); });

  test("stores the file as a document linked to this instruction and returns the file name", async () => {
    const res = await call("si.pdf");
    expect(res.status).toBe(201);
    expect((await res.json()).fileName).toBe("si.pdf");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.path).toBe("/documents");
    expect(uploads[0]!.entries).toMatchObject({ name: "si.pdf", category: "site_instruction", linkedEntityType: "construction_site_instruction", linkedEntityId: "si1" });
    expect(uploads[0]!.options).toMatchObject({ organizationId: "org1", root: true });
  });

  test("a file that is not a PDF or photo, or no file at all, is refused before anything is sent", async () => {
    const bad = await call("notes.exe");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("PDF or a photo");
    const none = await call("");
    expect(none.status).toBe(400);
    expect(uploads).toEqual([]);
  });

  test("a member (below project manager) is refused and nothing is sent", async () => {
    mockCtx = ctx("member");
    const res = await call("si.pdf");
    expect(res.status).toBe(403);
    expect(uploads).toEqual([]);
  });

  test("the server's own refusal text is passed through unchanged", async () => {
    upstreamError = new FakeVeridianApiError("Site instruction not found", 404);
    const res = await call("si.pdf");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Site instruction not found");
  });
});
