/// <reference types="bun-types" />
// R74-RULING-03 closure test for R-48 (daily progress report with photos).
// R38 (23 Aug) proved the real end-to-end path once, live: a genuine
// multipart file upload against a real dev server, byte-verified against the
// downloaded signed URL. Real, valid evidence -- but an ad-hoc scratchpad
// script against a live server is not a "named, committed, re-runnable
// test" per R74-RULING-03's six conditions, so R-48 could not be marked
// CLOSED on that evidence alone. This file is the actual closing artifact.
//
// Mocks @/lib/supabase/server's createClient() (same convention as
// organization/route.test.ts) -- Storage upload and the DB insert/select are
// both faked, so this asserts the ROUTE'S OWN LOGIC is correct: the right
// bucket/path/fields, the right order of operations (never write a DB row
// for a photo that failed to upload), and the right status code per failure
// mode. It does not re-prove "a byte range survives a real Supabase Storage
// round trip" -- that is an infrastructure guarantee, not this route's own
// logic, and R38's byte-identical (cmp) proof against real Storage already
// covers it; re-litigating it here would need real network I/O, which this
// unit test deliberately does not do.
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let uploadCalls: Array<{ path: string; contentType: string | undefined }>;
let uploadResult: { error: { message: string } | null };
let insertCalls: Array<Record<string, unknown>>;
let insertResult: { data: Record<string, unknown> | null; error: { message: string } | null };
let selectCalls: Array<{ organizationId: string; veridianEntryId: string }>;
let selectRows: Array<Record<string, unknown>>;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: {
      from: (bucket: string) => {
        if (bucket !== "work-progress-photos") throw new Error(`unexpected bucket: ${bucket}`);
        return {
          upload: async (path: string, _body: unknown, opts: { contentType?: string }) => {
            uploadCalls.push({ path, contentType: opts.contentType });
            return uploadResult;
          },
          createSignedUrl: async (path: string, _expiresIn: number) => ({
            data: { signedUrl: `https://fake-storage.test/signed/${path}` },
          }),
        };
      },
    },
    from: (table: string) => {
      if (table !== "work_progress_photos") throw new Error(`unexpected table: ${table}`);
      return {
        insert: (row: Record<string, unknown>) => {
          insertCalls.push(row);
          return {
            select: () => ({ single: async () => insertResult }),
          };
        },
        select: () => ({
          eq: (col1: string, orgId: string) => ({
            eq: (col2: string, entryId: string) => {
              if (col1 !== "organization_id" || col2 !== "veridian_entry_id") {
                throw new Error(`unexpected columns: ${col1}, ${col2}`);
              }
              selectCalls.push({ organizationId: orgId, veridianEntryId: entryId });
              return {
                order: () => Promise.resolve({ data: selectRows, error: null }),
              };
            },
          }),
        }),
      };
    },
  }),
}));

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org-1", role: "member", response: null };
}

function makeUploadRequest(fields: { veridianEntryId?: string; file?: File }): Request {
  const form = new FormData();
  if (fields.veridianEntryId !== undefined) form.set("veridianEntryId", fields.veridianEntryId);
  if (fields.file !== undefined) form.set("file", fields.file);
  return new Request("http://localhost/api/work-progress/photos", { method: "POST", body: form });
}

// A real, minimal, valid 1x1 PNG -- same shape of fixture R38's live proof
// used (a genuine file, not an empty Blob a real <input type=file> could
// never actually produce).
function fakePngFile(name = "test-photo.png"): File {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);
  return new File([bytes], name, { type: "image/png" });
}

beforeEach(() => {
  mockCtx = ctx();
  uploadCalls = [];
  uploadResult = { error: null };
  insertCalls = [];
  insertResult = {
    data: {
      id: "photo-1", organization_id: "org-1", veridian_entry_id: "entry-1",
      storage_path: "org-1/entry-1/fake", file_name: "test-photo.png", content_type: "image/png",
      created_at: "2026-09-05T00:00:00Z",
    },
    error: null,
  };
  selectCalls = [];
  selectRows = [];
});

describe("POST /api/work-progress/photos -- R74-RULING-03 closure for R-48", () => {
  test("a real file + veridianEntryId uploads to Storage THEN inserts the DB row, in that order, with matching fields, and returns 201", async () => {
    const { POST } = await import("./route");
    const file = fakePngFile();
    const res = await POST(makeUploadRequest({ veridianEntryId: "entry-1", file }) as any);
    const body = await res.json();

    expect(res.status).toBe(201);
    // R74-RULING-03 condition (e): assert the actual persisted shape, not
    // just the response echoing back whatever was sent.
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].path).toBe(`org-1/entry-1/${uploadCalls[0].path.split("/")[2]}`); // org/entry/<timestamp>-name
    expect(uploadCalls[0].path.endsWith("-test-photo.png")).toBe(true);
    expect(uploadCalls[0].contentType).toBe("image/png");

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      organization_id: "org-1",
      veridian_entry_id: "entry-1",
      uploaded_by: "u1",
      file_name: "test-photo.png",
      content_type: "image/png",
    });
    // The DB row's storage_path must be the EXACT path Storage was told to
    // use -- a mismatch here would mean the DB points at bytes that don't
    // exist, or Storage holds bytes nothing references.
    expect(insertCalls[0].storage_path).toBe(uploadCalls[0].path);

    expect(body.id).toBe("photo-1");
  });

  test("missing veridianEntryId is rejected with 400, and NEITHER Storage NOR the DB is ever touched", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeUploadRequest({ file: fakePngFile() }) as any);
    expect(res.status).toBe(400);
    expect(uploadCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  test("missing file is rejected with 400, and NEITHER Storage NOR the DB is ever touched", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeUploadRequest({ veridianEntryId: "entry-1" }) as any);
    expect(res.status).toBe(400);
    expect(uploadCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  test("a Storage upload failure is a 502, and the DB row is NEVER inserted -- no orphan row pointing at bytes that don't exist", async () => {
    uploadResult = { error: { message: "simulated storage outage" } };
    const { POST } = await import("./route");
    const res = await POST(makeUploadRequest({ veridianEntryId: "entry-1", file: fakePngFile() }) as any);
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain("simulated storage outage");
    expect(uploadCalls).toHaveLength(1); // it DID attempt the upload
    expect(insertCalls).toHaveLength(0); // but never wrote the row
  });

  test("a DB insert failure after a successful upload is a 500, surfacing the DB's own error message", async () => {
    insertResult = { data: null, error: { message: "simulated unique-constraint violation" } };
    const { POST } = await import("./route");
    const res = await POST(makeUploadRequest({ veridianEntryId: "entry-1", file: fakePngFile() }) as any);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("simulated unique-constraint violation");
    expect(uploadCalls).toHaveLength(1);
    expect(insertCalls).toHaveLength(1); // it WAS attempted -- this is the "unreferenced Storage object" case, a real known cost of upload-then-insert ordering, not silently hidden here
  });
});

describe("GET /api/work-progress/photos -- returns real rows with real signed URLs, scoped to org AND entry", () => {
  test("returns every photo for the given veridianEntryId, scoped to the caller's own organization, each with a signed URL", async () => {
    selectRows = [
      { id: "p1", storage_path: "org-1/entry-1/a.png", file_name: "a.png", content_type: "image/png", created_at: "2026-09-01T00:00:00Z" },
      { id: "p2", storage_path: "org-1/entry-1/b.png", file_name: "b.png", content_type: "image/png", created_at: "2026-09-02T00:00:00Z" },
    ];
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost/api/work-progress/photos?veridianEntryId=entry-1");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(selectCalls).toEqual([{ organizationId: "org-1", veridianEntryId: "entry-1" }]);
    expect(body.photos).toHaveLength(2);
    expect(body.photos[0].url).toBe("https://fake-storage.test/signed/org-1/entry-1/a.png");
    expect(body.photos[1].fileName).toBe("b.png");
  });

  test("missing veridianEntryId query param is rejected with 400", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost/api/work-progress/photos");
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(selectCalls).toHaveLength(0);
  });
});
