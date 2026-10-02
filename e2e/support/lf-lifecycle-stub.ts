// LOCAL-FIRST lifecycle (package lf-e12): the shared set-up of e2e/lf-lifecycle-*.spec.ts -- the life of the installed app in a real Chromium:
// release updates, the 426 gate, sign-out, two people on one laptop, long-lived sessions, eviction, and the real request count of a day.
//
// Same ground rules as e2e/offline-local-first.spec.ts (read it first): a PRODUCTION build with the release bundle, the local Auth stand-in
// (e2e/support/fake-supabase-server.mjs), and the sync service answered INSIDE the browser in the real service's shapes
// (compliance-tracker supabase/functions/projexa-sync/handler.ts, docs/local-first/CONTRACT.md). Differences, all on purpose:
//   * the sync service is routed on the BROWSER CONTEXT, not one page, so a second tab and the service worker are answered (and counted) too;
//   * it serves SEVERAL people: the person is read from the bearer token's `sub` (the sign-in id), exactly as the real service resolves it,
//     so two people on one laptop each get their own organisation's manifest and rows -- and a leak shows up as the wrong rows;
//   * every request is COUNTED by route (the same route names as src/lib/local-first/cost/budget.ts's routeOf), with its time;
//   * it can answer 426 UPDATE_REQUIRED on every non-release route (the real gate), 5xx for a while, and a newer release in /release/current.
// Nothing reaches Vercel, Supabase or any real network. Every value is a placeholder.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { signInLocally, stubAppApis, type AppStub, type LocalSession } from "./boq-local";
import type { FixtureLine, ProjectFixture } from "./boq-fixture";

// Written out in full on purpose: the specs must fail if src/lib/local-first/sync-client.ts names a different address.
export const SYNC_BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync";
const SYNC_PATH = "/functions/v1/projexa-sync";

export type Person = {
  email: string;
  name: string;
  /** The person's VERIDIAN id (compliance.users.id); the manifest also names the sign-in id in user.auth_user_id. */
  veridianId: string;
  orgId: string;
  projectId: string;
  projectName: string;
  boqId: string;
  boqTitle: string;
  lines: FixtureLine[];
};

export function makePerson(tag: string, org: string, projectName: string, boqTitle: string): Person {
  const projectId = `lf-${tag}-project`;
  const boqId = `lf-${tag}-boq`;
  const lines: FixtureLine[] = [1, 2, 3].map((n) => ({
    id: `lf-${tag}-line-${n}`, boqId, boqTitle, boqVersion: 1, boqStatus: "approved", parentLineItemId: null, activityId: null, itemCode: `${tag.toUpperCase()}-${n}`,
    category: "", description: `${projectName} item ${n}`, unit: "m2", quantity: String(10 * n), rate: "12.50", amount: String(125 * n) + ".00", createdAt: `2026-09-0${n}T00:00:00Z`,
  }));
  return { email: `${tag}@example.invalid`, name: `Person ${tag.toUpperCase()}`, veridianId: `clf${tag}person000000000001`.slice(0, 25), orgId: org, projectId, projectName, boqId, boqTitle, lines };
}

export function fixtureOf(p: Person): ProjectFixture {
  return {
    projectId: p.projectId, boqId: p.boqId, boqTitle: p.boqTitle, lines: p.lines,
    header: { id: p.boqId, projectId: p.projectId, version: 1, title: p.boqTitle, status: "approved", parentBoqId: null, createdAt: "2026-08-28T00:00:00.000Z" },
    expected: { total: p.lines.length, own: p.lines.length, formworkInProject: 0 },
  } as unknown as ProjectFixture;
}

export type RegistryFile = { path: string; file_no: number; file_version: number; sha256: string; size: number };
export type RegistryRelease = { release_version: string; manifest_sha256: string; built_at: string; files: RegistryFile[] };

export type Hit = { at: number; method: string; route: string; person: string | null; status: number };

export type SyncWorld = {
  net: "up" | "down" | "offline";
  /** Sign-in id (the token's sub) -> the person the service knows. */
  persons: Map<string, Person>;
  /** Every request that reached the stub (not CORS preflights), in order. Preflights are counted apart: a real browser sends them too. */
  hits: Hit[];
  preflights: number;
  /** When set, every route except the release routes answers 426 UPDATE_REQUIRED with this body's release fields. */
  updateRequired: { current: string | null; min_compatible: string } | null;
  /** The answer of GET /release/current. */
  release: { current: RegistryRelease | null; min_compatible: string | null };
  /** The bodies of POST /install. */
  installs: Array<Record<string, unknown>>;
  /** The X-Px-Client header of every request, in order. */
  clients: string[];
  /** The next N requests (any route) answer this status (503, 429...) instead. */
  failNext: { count: number; status: number };
  /** Bodies of POST /push. */
  pushes: unknown[];
};

export function newWorld(): SyncWorld {
  return { net: "up", persons: new Map(), hits: [], preflights: 0, updateRequired: null, release: { current: null, min_compatible: null }, installs: [], clients: [], failNext: { count: 0, status: 503 }, pushes: [] };
}

/** The route name the cost budget uses (src/lib/local-first/cost/budget.ts routeOf, copied: the spec must not import app code). */
export function routeName(path: string, body: unknown): string {
  const p = path.replace(/\/+$/, "");
  if (p === "/pull") return body && typeof body === "object" && Array.isArray((body as { ids?: unknown }).ids) ? "pull_ids" : "pull";
  const map: Record<string, string> = {
    "/manifest": "manifest", "/heads": "heads", "/changes": "changes", "/ids": "ids", "/push": "push", "/attest": "attest",
    "/release/current": "release_current", "/release/register": "release_register", "/install": "install",
    "/jobs/claim": "jobs_claim", "/jobs/heartbeat": "jobs_heartbeat", "/jobs/result": "jobs_result", "/jobs/enqueue": "jobs_enqueue", "/jobs/get": "jobs_get",
  };
  return map[p] ?? `other:${p}`;
}

export function countByRoute(hits: Hit[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of hits) out[h.route] = (out[h.route] ?? 0) + 1;
  return out;
}

const RELEASE_ROUTES = new Set(["release_current", "release_register", "install"]);

const CORS = (origin: string | undefined) => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-headers": "authorization, content-type, x-px-client, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  vary: "Origin",
});

function subOf(authorization: string | undefined): string | null {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  try {
    return (JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

const EPOCH = "lf-lifecycle-epoch-1";

/** Answers the sync service for every page of the context (and its service worker), per person, counting every request. */
export async function stubSyncService(context: BrowserContext, world: SyncWorld): Promise<void> {
  await context.route(`${SYNC_BASE}/**`, async (route: Route, request) => {
    const origin = request.headers()["origin"];
    if (request.method() === "OPTIONS") {
      world.preflights += 1;
      return route.fulfill({ status: 204, headers: CORS(origin) });
    }
    if (world.net !== "up") return route.abort(world.net === "offline" ? "internetdisconnected" : "connectionrefused");
    const path = new URL(request.url()).pathname.slice(SYNC_PATH.length);
    let body: unknown = undefined;
    try { body = request.postDataJSON(); } catch { body = undefined; }
    const name = routeName(path, body);
    const sub = subOf(request.headers()["authorization"]);
    const person = sub ? world.persons.get(sub) ?? null : null;
    world.clients.push(request.headers()["x-px-client"] ?? "");
    const reply = (status: number, payload: unknown) => {
      world.hits.push({ at: Date.now(), method: request.method(), route: name, person: person?.email ?? null, status });
      return route.fulfill({ status, headers: { ...CORS(origin), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(payload) });
    };
    const now = () => new Date().toISOString();

    if (world.failNext.count > 0) {
      world.failNext.count -= 1;
      return reply(world.failNext.status, { error: "Service unavailable" });
    }
    if (!person) return reply(401, { error: "Unauthorized" });
    if (world.updateRequired && !RELEASE_ROUTES.has(name)) {
      return reply(426, { error: "Update required", code: "UPDATE_REQUIRED", current: world.updateRequired.current, min_compatible: world.updateRequired.min_compatible, protocol: 2, reason: "release" });
    }
    switch (name) {
      case "manifest":
        return reply(200, {
          user: { id: person.veridianId, auth_user_id: sub, name: person.name, role: "owner", org_id: person.orgId },
          projects: [{ id: person.projectId, name: person.projectName, status: "active" }],
          kinds: [{ kind: "boq_lines", project_scoped: true, cursor_field: "updated_at", deletes_supported: true }],
          view_class: "0123456789abcdef", org_kinds: [], org_view_class: null,
          release: { current: world.release.current?.release_version ?? null, min_compatible: world.release.min_compatible, protocol: 2 },
          server_time: now(),
        });
      case "heads":
        return reply(200, { heads: { [person.projectId]: 0, __org__: 0 }, projects_etag: `etag-${person.orgId}`, role: "owner", view_class: "0123456789abcdef", org_view_class: null, epoch: EPOCH, server_time: now() });
      case "pull":
      case "pull_ids": {
        const b = (body ?? {}) as { project_id?: string; kind?: string; ids?: string[] };
        if (b.project_id !== person.projectId || b.kind !== "boq_lines") return reply(404, { error: "not found" });
        const rows = b.ids ? person.lines.filter((l) => b.ids!.includes(l.id)) : person.lines;
        return reply(200, { items: rows.map((l) => ({ id: l.id, updated_at: l.createdAt, version: 1, data: l })), kid: null, next_cursor: null, has_more: false, hidden_fields: [], redacted: false, server_time: now() });
      }
      case "changes":
        return reply(200, { changes: [], next_seq: 0, has_more: false, head_seq: 0, reset_required: false, epoch: EPOCH, server_time: now() });
      case "ids": {
        const ids = person.lines.map((l) => l.id);
        return reply(200, { ids, has_more: false, next_id: null, versions: ids.map(() => 1), head_seq: 0, epoch: EPOCH, server_time: now() });
      }
      case "push": {
        world.pushes.push(body);
        const ops = ((body as { ops?: Array<{ op_id?: string }> })?.ops ?? []);
        return reply(200, { results: ops.map((o) => ({ op_id: o.op_id, status: "applied" })), server_time: now() });
      }
      case "release_current":
        return reply(200, { registered: true, current: world.release.current, min_compatible: world.release.min_compatible, protocol: 2, server_time: now() });
      case "release_register":
        return reply(200, { registered: true, server_time: now() });
      case "install":
        world.installs.push(body as Record<string, unknown>);
        return reply(200, { recorded: true, server_time: now() });
      default:
        return reply(404, { error: "not part of the local stub" });
    }
  });
}

// ─── reading what is really stored on the laptop ───────────────────────────────────────────────

export function readMeta(page: Page, dbName: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, key }) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => resolve(undefined);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("meta")) { db.close(); resolve(undefined); return; }
          const get = db.transaction("meta", "readonly").objectStore("meta").get(key);
          get.onerror = () => { db.close(); resolve(undefined); };
          get.onsuccess = () => { db.close(); resolve((get.result as { value?: unknown } | undefined)?.value); };
        };
      }),
    { dbName, key }
  );
}

export function writeMeta(page: Page, dbName: string, key: string, value: unknown): Promise<void> {
  return page.evaluate(
    ({ dbName, key, value }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("meta", "readwrite");
          tx.objectStore("meta").put({ key, value });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      }),
    { dbName, key, value }
  );
}

export const deviceMeta = (page: Page, key: string) => readMeta(page, "projexa-local", key);
export const personDb = (userId: string) => `projexa-local:${userId}`;
export const personMeta = (page: Page, userId: string, key: string) => readMeta(page, personDb(userId), key);

/** Every database of this origin (names only). */
export const databases = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").sort());

/** Everything a person's local database holds, as one string (rows, outbox, drafts, meta), to look for another person's words in it. */
export function dumpDb(page: Page, dbName: string): Promise<string> {
  return page.evaluate(
    (dbName) =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => resolve("");
        open.onsuccess = () => {
          const db = open.result;
          const names = [...db.objectStoreNames];
          if (names.length === 0) { db.close(); resolve(""); return; }
          const tx = db.transaction(names, "readonly");
          const parts: unknown[] = [];
          for (const n of names) {
            const req = tx.objectStore(n).getAll();
            req.onsuccess = () => parts.push({ store: n, rows: req.result });
          }
          tx.oncomplete = () => { db.close(); resolve(JSON.stringify(parts)); };
          tx.onerror = () => { db.close(); resolve(JSON.stringify(parts)); };
        };
      }),
    dbName
  );
}

export const releaseCaches = (page: Page) => page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith("px-release-")).sort());

/** The service worker's own pointer (px-sw-meta /__px/active-release): which release is active, for whom, in which mode. */
export const swPointer = (page: Page) =>
  page.evaluate(async () => {
    const cache = await caches.open("px-sw-meta");
    const res = await cache.match("/__px/active-release");
    return res ? ((await res.json()) as { version: string | null; personId: string | null; localFirst: boolean }) : null;
  });

// ─── a person signs in and the laptop gets prepared, the way a person does ──────────────────────

export type Prepared = { session: LocalSession; app: AppStub };

/** Signs the person in (a session cookie from the local Auth stand-in), registers them with the stub, and answers the page's /api calls for them. */
export async function signIn(page: Page, context: BrowserContext, world: SyncWorld, person: Person): Promise<Prepared> {
  const session = await signInLocally(context, person.email);
  world.persons.set(session.userId, person);
  await page.unroute("**/api/**").catch(() => {});
  const app = await stubAppApis(page, fixtureOf(person), session);
  return { session, app };
}

/** Opens the app online; the first-run screen prepares the workspace; the boot installs the release; the page ends up controlled by the worker. */
export async function prepareLaptop(page: Page, context: BrowserContext, world: SyncWorld, person: Person): Promise<Prepared> {
  const prepared = await signIn(page, context, world, person);
  await page.goto(`/scope/${person.boqId}`);
  await expect(page.getByTestId("prepare-percent"), "the 'Preparing your workspace' screen never reached 100%").toHaveText("100%", { timeout: 240_000 });
  await page.getByTestId("prepare-continue").click();
  await expect
    .poll(() => deviceMeta(page, "app:release"), { timeout: 240_000, message: "the release was never installed (meta app:release)" })
    .toMatchObject({ version: expect.stringMatching(/^\d{4}\.\d{2}\.\d{2}-\d{3}$/) });
  await expect.poll(() => releaseCaches(page), { message: "no px-release-<version> cache exists" }).toHaveLength(1);
  await expect
    .poll(() => personMeta(page, prepared.session.userId, `sync:done:${person.projectId}:boq_lines`), { timeout: 120_000, message: "the BOQ lines were never copied to the laptop" })
    .toBeTruthy();
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { message: "the service worker does not control the page" }).toBe(true);
  return prepared;
}

// ─── release N+1, built from the real build plus one changed file ───────────────────────────────

export type BuiltRelease = {
  manifest: { release_version: string; manifest_sha256: string; built_at: string; bundle: { path: string; size: number; sha256: string }; files: { path: string; size: number; sha256: string }[] } & Record<string, unknown>;
  /** The bytes of each file of the release (by path), and of the bundle. */
  files: Map<string, Buffer>;
  bundle: Buffer;
};

/**
 * Release N+1: exactly what scripts/make-release.mjs builds (its own exported functions, so the manifest digest, the deterministic tar and
 * the numbering are the build's), from this checkout's real build output plus ONE new public file, as release YYYY.MM.DD-<build>. The
 * build number is the only difference besides the file, as with the real next deploy.
 */
export async function buildNextRelease(root: string, buildNumber: string, extra: { path: string; text: string }): Promise<BuiltRelease> {
  const mr = (await import(join(root, "scripts", "make-release.mjs"))) as {
    collectFiles(root: string): { path: string; bytes: Buffer }[];
    makeTar(entries: { path: string; bytes: Buffer }[]): Buffer;
    gzipDeterministic(bytes: Buffer): Buffer;
    canonicalJson(v: unknown): string;
    sha256Hex(b: Buffer | string): string;
    readLocalDbVersion(root: string): number;
    releaseVersion(o: { date: Date; buildNumber: string; sha: string }): string;
  };
  const current = JSON.parse(readFileSync(join(root, "public", "_release", "release.json"), "utf8")) as { release_version: string };
  const files = mr.collectFiles(root).concat([{ path: extra.path, bytes: Buffer.from(extra.text, "utf8") }]).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const version = `${current.release_version.slice(0, 10)}-${buildNumber.padStart(3, "0")}`;
  const bundle = mr.gzipDeterministic(mr.makeTar(files));
  const body = {
    release_version: version,
    git_sha: null,
    built_at: new Date().toISOString(),
    protocol: 2,
    schema: mr.readLocalDbVersion(root),
    bundle: { path: `_release/px-${version}.tar.gz`, size: bundle.length, sha256: mr.sha256Hex(bundle) },
    files: files.map((f) => ({ path: f.path, size: f.bytes.length, sha256: mr.sha256Hex(f.bytes) })),
  };
  const manifest = { ...body, manifest_sha256: mr.sha256Hex(mr.canonicalJson(body)) };
  return { manifest, files: new Map(files.map((f) => [f.path, f.bytes])), bundle };
}

/** The registry's numbering of a release: file_no permanent per path, file_version bumped when the bytes changed (CONTRACT.md section 3). */
export function numbered(release: BuiltRelease["manifest"], previous: RegistryRelease | null): RegistryRelease {
  const prev = new Map((previous?.files ?? []).map((f) => [f.path, f]));
  let nextNo = Math.max(0, ...(previous?.files ?? []).map((f) => f.file_no)) + 1;
  return {
    release_version: release.release_version,
    manifest_sha256: release.manifest_sha256,
    built_at: release.built_at,
    files: release.files.map((f) => {
      const p = prev.get(f.path);
      return { path: f.path, file_no: p ? p.file_no : nextNo++, file_version: p ? (p.sha256 === f.sha256 ? p.file_version : p.file_version + 1) : 1, sha256: f.sha256, size: f.size };
    }),
  };
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ─── console hygiene ────────────────────────────────────────────────────────────────────────────

/**
 * Collects the page's console errors and uncaught exceptions. Expected noise is named, never a blanket filter: a request this spec ABORTED on
 * purpose (offline / server down) makes Chromium print "Failed to load resource: net::ERR_..." for it, which is the test's own doing.
 */
export function watchConsole(page: Page): { errors: string[]; unexpected: () => string[]; aiTamper: () => number } {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  const expected = [/^Failed to load resource: net::ERR_(INTERNET_DISCONNECTED|CONNECTION_REFUSED|CONNECTION_RESET|FAILED)/, /^Failed to load resource: the server responded with a status of (426|503|429|404|401)/];
  // FINDING (lf-e12, NOT fixed: an integrity check, see the report): after a sign-out the worker drops the release caches while the device
  // meta still names the release, and the browser AI's integrity check (src/lib/local-first/ai/integrity.ts) reads that as TAMPERING and
  // switches the AI off with this error. It is counted apart, never ignored: the session specs assert exactly where it appears.
  const tamper = /^\[projexa\] AI access switched off: the installed release does not match its recorded fingerprints/;
  return {
    errors,
    unexpected: () => errors.filter((e) => !expected.some((r) => r.test(e)) && !tamper.test(e)),
    aiTamper: () => errors.filter((e) => tamper.test(e)).length,
  };
}
