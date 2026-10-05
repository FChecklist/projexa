// AUDIT-100 B13 -- READ-ONLY evidence that a new PROJEXA release replaces the installed copy and keeps the local data,
// against the REAL release registry (the projexa-sync service's platform.projexa_release* tables), the REAL production
// deploys (GitHub's record of Vercel's Production deployments of main) and the REAL live site (https://projexa-ai.com).
//
// Run by hand, never in CI (it needs the network and a Supabase access token):
//   SUPABASE_ACCESS_TOKEN=... bun scripts/verify/release-registry-live.mjs [--deploys 12] [--since <iso>] [--write-fixtures] [--no-files]
// It writes ai-os/audit37/evidence/release-registry-<utc>.json and exits 0 only when every check passed.
//
// What it does, all read-only (no login, no cookies, no deploy, no write anywhere but the local evidence/fixture files):
//   1. REGISTRY HISTORY: reads the registry through the Supabase Management API's read-only query endpoint, the last
//      N main commits and Production deployments (gh api / api.github.com), and checks (checkHistory below):
//        - every release_version is YYYY.MM.DD-NNN, its date is its built_at's UTC date, registered_at >= built_at;
//        - ordered by built_at the versions are strictly increasing (the order a laptop and the min_compatible floor
//          compare them in); no manifest digest is registered twice;
//        - every Production deploy of a main commit maps to ONE registered release by git_sha, built after the commit
//          and in the same order as the deploys; a deploy without a release is reported with the reason (superseded
//          before any laptop asked the service to register it, or its version number was already TAKEN).
//   2. LIVE INTEGRITY: the release the registry says is current must be the one the live site serves; its manifest digest
//      must be what the canonical manifest hashes to; then EVERY file (and the one bundle) is downloaded from the live site,
//      sequentially with a small pause, and its sha256 and size must equal the registered ones.
//   3. CLIENT SWITCH WITH REAL BYTES: the app's real installer (src/lib/local-first/release/installer.ts) runs on a
//      simulated laptop (fake-indexeddb with the app's real local database, in-memory Cache Storage) that has release N
//      (the registry's previous release, its manifest rebuilt from the registry and digest-checked) installed and a person's
//      records and queued edit in it; the live site serves N+1. Asserted: the switch happens, N's cache is still whole when
//      the switch is asked for and only goes after it, the meta names N+1, and the person's records/outbox are untouched.
//      Then the same with one live file's bytes altered on the way: refused, nothing switches, N stays.
//   --write-fixtures also writes the real manifests/registry rows (no personal data: paths, hashes, sizes, times, shas)
//   to src/lib/local-first/__fixtures__/release-real/ for the CI test release-real-manifests.test.ts.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PROJECT_REF = "pcrjmlpuqsbocqfwoxod"; // the compliance-tracker Supabase project that hosts projexa-sync
export const LIVE_ORIGIN = "https://projexa-ai.com";
export const REPO = "FChecklist/projexa";
const VERSION_RE = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{3})$/;

const ROOT = join(import.meta.dir ?? dirname(new URL(import.meta.url).pathname), "..", "..");

// ─── pure checks (unit-tested in src/lib/local-first/release-real-manifests.test.ts) ─────────────────────────────

const ms = (iso) => Date.parse(iso);
const utcDay = (iso) => new Date(iso).toISOString().slice(0, 10).replace(/-/g, ".");

/**
 * history = { releases: [{release_version, manifest_sha256, git_sha, built_at, registered_at}],
 *             deployments: [{sha, created_at}], commits: [{sha, date}] }   (deployments/commits newest first or any order)
 * since: only releases built at/after this ISO time, and deployments created at/after it, are judged.
 * Returns { ok, defects: [{code, ...}], notes: [{code, ...}], mapped: [...] }.
 */
export function checkHistory(history, { since = null } = {}) {
  const defects = [];
  const notes = [];
  const sinceMs = since ? ms(since) : -Infinity;
  const all = [...history.releases].sort((a, b) => ms(a.built_at) - ms(b.built_at) || (a.release_version < b.release_version ? -1 : 1));
  const releases = all.filter((r) => ms(r.built_at) >= sinceMs);

  for (const r of releases) {
    const m = VERSION_RE.exec(r.release_version);
    if (!m) defects.push({ code: "VERSION_FORMAT", release_version: r.release_version });
    else if (`${m[1]}.${m[2]}.${m[3]}` !== utcDay(r.built_at)) defects.push({ code: "VERSION_DATE_NOT_BUILD_DATE", release_version: r.release_version, built_at: r.built_at });
    if (ms(r.registered_at) < ms(r.built_at)) defects.push({ code: "REGISTERED_BEFORE_BUILT", release_version: r.release_version });
  }
  for (let i = 1; i < releases.length; i += 1) {
    const prev = releases[i - 1];
    const cur = releases[i];
    if (!(prev.release_version < cur.release_version)) {
      defects.push({ code: "VERSION_NOT_MONOTONIC", earlier: prev.release_version, earlier_built_at: prev.built_at, later: cur.release_version, later_built_at: cur.built_at });
    }
  }
  const seenDigest = new Map();
  for (const r of releases) {
    if (seenDigest.has(r.manifest_sha256)) defects.push({ code: "DIGEST_TWICE", a: seenDigest.get(r.manifest_sha256), b: r.release_version });
    seenDigest.set(r.manifest_sha256, r.release_version);
  }

  // deploys of main commits -> registered releases
  const commitDate = new Map(history.commits.map((c) => [c.sha, c.date]));
  const byGit = new Map();
  for (const r of all) {
    if (!r.git_sha) continue;
    if (byGit.has(r.git_sha)) notes.push({ code: "SAME_COMMIT_REGISTERED_TWICE", git_sha: r.git_sha, versions: [byGit.get(r.git_sha).release_version, r.release_version] });
    else byGit.set(r.git_sha, r);
  }
  const deploys = history.deployments
    .filter((d) => commitDate.has(d.sha) && ms(d.created_at) >= sinceMs)
    .sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const mapped = [];
  for (let i = 0; i < deploys.length; i += 1) {
    const d = deploys[i];
    const r = byGit.get(d.sha);
    if (!r) {
      // Registration is lazy: the service registers whatever the live site serves when a signed-in laptop asks. A deploy
      // replaced before anyone asked is legitimately never registered -- unless its version number was already taken.
      const oldScheme = shaDerivedVersion(d.created_at, d.sha);
      const taken = all.find((x) => x.release_version === oldScheme && x.git_sha !== d.sha);
      const later = deploys.slice(i + 1).find((x) => byGit.has(x.sha));
      if (taken) defects.push({ code: "VERSION_TAKEN", deploy_sha: d.sha, deploy_created_at: d.created_at, version: oldScheme, held_by: taken.git_sha });
      else if (!later) defects.push({ code: "LIVE_DEPLOY_NOT_REGISTERED", deploy_sha: d.sha, deploy_created_at: d.created_at });
      else notes.push({ code: "SUPERSEDED_BEFORE_REGISTRATION", deploy_sha: d.sha, deploy_created_at: d.created_at, next_registered: later.sha });
      mapped.push({ deploy_sha: d.sha, deploy_created_at: d.created_at, release_version: null });
      continue;
    }
    if (ms(r.built_at) < ms(commitDate.get(d.sha))) defects.push({ code: "BUILT_BEFORE_COMMIT", release_version: r.release_version, commit_date: commitDate.get(d.sha), built_at: r.built_at });
    // the GitHub deployment record is written when Vercel finishes; the build is minutes before it, never hours
    if (ms(r.built_at) > ms(d.created_at) + 30 * 60_000 || ms(r.built_at) < ms(d.created_at) - 60 * 60_000) {
      defects.push({ code: "BUILD_TIME_NOT_THE_DEPLOY", release_version: r.release_version, built_at: r.built_at, deploy_created_at: d.created_at });
    }
    mapped.push({ deploy_sha: d.sha, deploy_created_at: d.created_at, release_version: r.release_version, built_at: r.built_at, registered_at: r.registered_at });
  }
  const reg = mapped.filter((m) => m.release_version);
  for (let i = 1; i < reg.length; i += 1) {
    if (!(ms(reg[i - 1].built_at) < ms(reg[i].built_at))) defects.push({ code: "DEPLOY_ORDER_NOT_REGISTRY_ORDER", earlier_deploy: reg[i - 1].deploy_sha, later_deploy: reg[i].deploy_sha });
  }
  return { ok: defects.length === 0, defects, notes, mapped };
}

/** The numbering make-release.mjs used until AUDIT-100 B13: NNN = first 6 hex of the commit sha mod 1000 (no BUILD_NUMBER on Vercel). */
export function shaDerivedVersion(iso, sha) {
  return `${utcDay(iso)}-${String(parseInt(String(sha).slice(0, 6), 16) % 1000).padStart(3, "0")}`;
}

/** Rebuilds a release's manifest from its registry rows (release + files); its digest must equal the registered one. */
export function manifestFromRegistry(release, files) {
  const body = {
    release_version: release.release_version,
    git_sha: release.git_sha ?? null,
    built_at: new Date(release.built_at).toISOString(),
    protocol: Number(release.protocol),
    schema: Number(release.schema_version),
    bundle: { path: release.bundle_path, size: Number(release.bundle_size), sha256: release.bundle_sha256 },
    files: [...files]
      .map((f) => ({ path: f.path, size: Number(f.size), sha256: f.sha256 }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  return { ...body, manifest_sha256: sha256Hex(canonicalJson(body)) };
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
    .join(",")}}`;
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

// ─── I/O (only when run as a script) ────────────────────────────────────────────────────────────────

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function sql(query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not set");
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`registry query answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function gh(path) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return JSON.parse(execFileSync(process.platform === "win32" ? "gh.exe" : "gh", ["api", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    } catch (err) {
      if (attempt === 4) throw err;
      execFileSync(process.execPath, ["-e", "setTimeout(()=>{},3000)"]);
    }
  }
}

const sleep = (n) => new Promise((r) => setTimeout(r, n));

async function liveGet(path) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${LIVE_ORIGIN}${path}`, { credentials: "omit", cache: "no-store", redirect: "manual", headers: { "user-agent": "projexa-audit-b13-readonly" } });
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, bytes };
    } catch (err) {
      if (attempt === 3) return { status: 0, bytes: new Uint8Array(), error: String(err) };
      await sleep(1000 * attempt);
    }
  }
}

async function main() {
  const started = new Date().toISOString();
  const nDeploys = Number(arg("deploys", 12));
  const since = arg("since", null);
  const evidence = { kind: "AUDIT-100 B13 release registry live evidence", started, origin: LIVE_ORIGIN, project_ref: PROJECT_REF, checks: {} };
  const fail = [];

  // 1. history
  const releases = await sql(
    "select release_version, manifest_sha256, git_sha, built_at, registered_at, files_count, bytes_total, protocol, schema_version, bundle_path, bundle_size, bundle_sha256 from platform.projexa_release order by built_at, release_version",
  );
  const commits = gh(`repos/${REPO}/commits?sha=main&per_page=${Math.max(nDeploys * 2, 30)}`).map((c) => ({ sha: c.sha, date: c.commit.committer.date }));
  const deployments = gh(`repos/${REPO}/deployments?environment=Production&per_page=${nDeploys}`).map((d) => ({ sha: d.sha, created_at: d.created_at }));
  const history = {
    releases: releases.map((r) => ({ release_version: r.release_version, manifest_sha256: r.manifest_sha256, git_sha: r.git_sha, built_at: new Date(r.built_at).toISOString(), registered_at: new Date(r.registered_at).toISOString(), files_count: r.files_count })),
    deployments,
    commits,
  };
  const hist = checkHistory(history, { since });
  evidence.checks.history = { since, releases: history.releases.length, deployments: deployments.length, ...hist };
  if (!hist.ok) fail.push("history");

  // 2. live integrity
  // public.projexa_release_current() (drizzle/0680) is not executable by the read-only role, so its exact selection is repeated
  // here: the newest BUILT_AT (then release_version) is current, its files ordered by file_no, and the policy's floor.
  const top = await sql("select release_version, manifest_sha256, git_sha, built_at from platform.projexa_release order by built_at desc, release_version desc limit 1");
  const curFiles = await sql(`select path, file_no, file_version, sha256, size from platform.projexa_release_file where release_version = '${top[0].release_version.replace(/[^0-9.-]/g, "")}' order by file_no`);
  const [policy] = await sql("select min_compatible from platform.projexa_release_policy where id");
  const current = { release_version: top[0].release_version, manifest_sha256: top[0].manifest_sha256, git_sha: top[0].git_sha, built_at: new Date(top[0].built_at).toISOString(), files: curFiles.map((f) => ({ ...f, size: Number(f.size) })) };
  const cur = { c: { registered: true, current, min_compatible: policy?.min_compatible ?? "" } };
  const live = await liveGet("/_release/release.json");
  const liveManifest = JSON.parse(new TextDecoder().decode(live.bytes));
  const { manifest_sha256: claimed, ...liveBody } = liveManifest;
  const integrity = {
    registry_current: current.release_version,
    live_release: liveManifest.release_version,
    live_digest_self_consistent: sha256Hex(canonicalJson(liveBody)) === claimed,
    live_is_registry_current: claimed === current.manifest_sha256 && liveManifest.release_version === current.release_version,
    registry_files_equal_manifest: false,
    files_checked: 0,
    files_bad: [],
    bundle_ok: null,
  };
  const regFiles = new Map(current.files.map((f) => [f.path, f]));
  integrity.registry_files_equal_manifest =
    regFiles.size === liveManifest.files.length && liveManifest.files.every((f) => regFiles.get(f.path)?.sha256 === f.sha256 && Number(regFiles.get(f.path)?.size) === f.size);
  const liveBytes = new Map();
  if (!arg("no-files")) {
    for (const f of liveManifest.files) {
      const url = f.path === "_shell/local.html" ? "/local" : `/${f.path}`;
      const got = await liveGet(url);
      integrity.files_checked += 1;
      const hash = sha256Hex(got.bytes);
      if (got.status !== 200 || hash !== f.sha256 || got.bytes.length !== f.size) integrity.files_bad.push({ path: f.path, status: got.status, size: got.bytes.length, expected_size: f.size, sha256: hash });
      else liveBytes.set(f.path, got.bytes);
      await sleep(40);
    }
    const bundle = await liveGet(`/${liveManifest.bundle.path}`);
    integrity.bundle_ok = bundle.status === 200 && bundle.bytes.length === liveManifest.bundle.size && sha256Hex(bundle.bytes) === liveManifest.bundle.sha256;
    if (integrity.bundle_ok) {
      // what a first install unpacks: every file inside the one bundle must also match the registered hash
      const { readBundle } = await import("../../src/lib/local-first/release/bundle.ts");
      const { gunzipSync } = await import("node:zlib");
      const entries = await readBundle(bundle.bytes, async (b) => new Uint8Array(gunzipSync(b)));
      const inBundle = new Map(entries.map((e) => [e.path, e.bytes]));
      integrity.bundle_files_bad = liveManifest.files.filter((f) => !inBundle.has(f.path) || sha256Hex(inBundle.get(f.path)) !== f.sha256 || inBundle.get(f.path).length !== f.size).map((f) => f.path);
      integrity.bundle_extra_files = entries.filter((e) => !regFiles.has(e.path)).map((e) => e.path);
      // the simulated laptop below needs every byte; a file its own URL refuses is taken from the verified bundle, as a first install does
      for (const f of liveManifest.files) if (!liveBytes.has(f.path) && inBundle.has(f.path) && sha256Hex(inBundle.get(f.path)) === f.sha256) liveBytes.set(f.path, inBundle.get(f.path));
    }
  }
  evidence.checks.integrity = integrity;
  if (!integrity.live_digest_self_consistent || !integrity.live_is_registry_current || !integrity.registry_files_equal_manifest || integrity.files_bad.length || integrity.bundle_ok === false || integrity.bundle_files_bad?.length || integrity.bundle_extra_files?.length) fail.push("integrity");

  // 3. the previous release, rebuilt from the registry
  const prevRow = releases.filter((r) => r.release_version !== current.release_version).sort((a, b) => ms(b.built_at) - ms(a.built_at))[0];
  const prevFiles = await sql(`select path, file_no, file_version, sha256, size from platform.projexa_release_file where release_version = '${prevRow.release_version.replace(/[^0-9.-]/g, "")}' order by file_no`);
  const prevManifest = manifestFromRegistry(prevRow, prevFiles);
  const prevDigestOk = prevManifest.manifest_sha256 === prevRow.manifest_sha256;
  evidence.checks.previous_release = { release_version: prevRow.release_version, rebuilt_digest_equals_registered: prevDigestOk };
  if (!prevDigestOk) fail.push("previous_release");

  if (!arg("no-files") && liveBytes.size === liveManifest.files.length) {
    const sw = await realSwitch({ prevManifest, prevFiles, nextManifest: liveManifest, liveBytes });
    evidence.checks.switch = sw;
    if (!sw.ok) fail.push("switch");
  }

  if (arg("write-fixtures")) {
    const dir = join(ROOT, "src", "lib", "local-first", "__fixtures__", "release-real");
    mkdirSync(dir, { recursive: true });
    const w = (name, value) => writeFileSync(join(dir, name), `${JSON.stringify(value, null, 1)}\n`);
    w("manifest-n.json", prevManifest);
    w("manifest-n1.json", liveManifest);
    w("registry-n.json", { release_version: prevRow.release_version, manifest_sha256: prevRow.manifest_sha256, built_at: prevManifest.built_at, files: prevFiles.map((f) => ({ path: f.path, file_no: f.file_no, file_version: f.file_version, sha256: f.sha256, size: Number(f.size) })) });
    w("registry-current-n1.json", { registered: cur.c.registered, current, min_compatible: cur.c.min_compatible || null });
    w("history.json", { captured_at: started, ...history });
    evidence.fixtures_written = dir;
  }

  evidence.finished = new Date().toISOString();
  evidence.ok = fail.length === 0;
  evidence.failed = fail;
  const out = join(ROOT, "ai-os", "audit37", "evidence", `release-registry-${started.replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(evidence, null, 1)}\n`);
  console.log(JSON.stringify({ ok: evidence.ok, failed: fail, out, defects: hist.defects.map((d) => d.code), integrity: { ...integrity, files_bad: integrity.files_bad.length }, switch: evidence.checks.switch && { ok: evidence.checks.switch.ok, steps: evidence.checks.switch.steps } }, null, 1));
  process.exit(evidence.ok ? 0 : 1);
}

/** The app's real installer on a simulated laptop: N installed with a person's data, the live site serves N+1. */
async function realSwitch({ prevManifest, prevFiles, nextManifest, liveBytes }) {
  const { IDBFactory } = await import("fake-indexeddb");
  const { openLocalDb } = await import("../../src/lib/local-first/local-db.ts");
  const { installRelease } = await import("../../src/lib/local-first/release/installer.ts");
  const { META_KEYS, releaseCacheName, urlForReleasePath } = await import("../../src/lib/local-first/release/release-constants.ts");
  const { FakeCacheStorage } = await import("../../src/lib/local-first/release/__fixtures__/fakes.ts");
  const steps = [];
  const check = (name, ok, detail = undefined) => steps.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });

  const run = async (tamperPath) => {
    const db = await openLocalDb(new IDBFactory(), "projexa-local");
    const caches = new FakeCacheStorage();
    const N = prevManifest.release_version;
    const nextSha = new Map(nextManifest.files.map((f) => [f.path, f.sha256]));
    const oldCache = await caches.open(releaseCacheName(N));
    let realOld = 0;
    for (const f of prevManifest.files) {
      // unchanged files: N's bytes ARE the live bytes (same sha256); a file only N had cannot be fetched any more (the live site
      // serves N+1), and the installer never reads it -- it is only there so N's cache is complete, as on a real laptop.
      const same = nextSha.get(f.path) === f.sha256;
      const bytes = same ? liveBytes.get(f.path) : new TextEncoder().encode(`release ${N} only: ${f.path}`);
      if (same) realOld += 1;
      await oldCache.put(urlForReleasePath(f.path), new Response(bytes));
    }
    await db.setMeta(META_KEYS.release, { version: N, manifest_sha256: prevManifest.manifest_sha256, git_sha: prevManifest.git_sha, built_at: prevManifest.built_at, protocol: prevManifest.protocol, schema: prevManifest.schema, downloaded_at: prevManifest.built_at, installed_at: prevManifest.built_at, files: prevManifest.files.length, bytes: 0, mode: "full" });
    await db.setMeta(META_KEYS.files, { version: N, rows: prevFiles.map((f) => ({ path: f.path, file_no: f.file_no, file_version: f.file_version, sha256: f.sha256, size: Number(f.size), version: N })) });
    // the person's own data on this laptop
    await db.putRecord({ id: "tasks:t-b13", type: "tasks", orgId: "org-b13", projectId: "p-b13", data: { id: "t-b13", title: "Fix the site gate" }, serverVersion: 3 });
    await db.putRecord({ id: "boq_items:b-b13", type: "boq_items", orgId: "org-b13", projectId: "p-b13", data: { id: "b-b13", description: "Tiling", qty: 12 }, serverVersion: 1, dirty: "op-b13" });
    await db.putOp({ opId: "op-b13", functionId: "update_boq_item", projectId: "p-b13", params: { qty: 12 }, record: { kind: "boq_items", id: "b-b13", baseVersion: 1 }, clientAt: "2026-10-05T10:00:00Z", status: "pending", attempts: 0, nextAttemptAt: 0 });
    const before = JSON.stringify({ rows: await db.listByOrg("org-b13"), ops: await db.listOps() });

    const asked = [];
    let atSwitch = null;
    const fetchImpl = async (input, init) => {
      const path = typeof input === "string" ? input : input.url;
      asked.push(path);
      const res = await fetch(`${LIVE_ORIGIN}${path}`, { ...init, credentials: "omit" });
      if (tamperPath && path === urlForReleasePath(tamperPath)) {
        const b = new Uint8Array(await res.arrayBuffer());
        b[0] ^= 0xff;
        return new Response(b, { status: 200 });
      }
      return res;
    };
    const result = await installRelease({
      fetchImpl,
      caches,
      meta: db,
      deviceId: "audit-b13-simulated-laptop",
      switchTo: async (v) => {
        const nextCache = caches.caches.get(releaseCacheName(v));
        atSwitch = { version: v, n_cache_still_there: await caches.has(releaseCacheName(N)), n1_cache_files: nextCache ? nextCache.entries.size : 0 };
      },
    });
    const after = JSON.stringify({ rows: await db.listByOrg("org-b13"), ops: await db.listOps() });
    return { N, result, asked, atSwitch, before, after, caches, db, realOld, META_KEYS, releaseCacheName };
  };

  const good = await run(null);
  const N1 = nextManifest.release_version;
  check("real installer reports an update to the live release", good.result.status === "updated" && good.result.version === N1, good.result);
  check("only the files that changed between N and N+1 were downloaded (partial)", good.result.mode === "partial" && good.asked.length - 1 === good.result.downloadedFiles, { downloaded: good.result.downloadedFiles, of: nextManifest.files.length, unchanged_reused_from_N: good.realOld });
  check("at the moment of the switch N's cache was still there and N+1's held every file", good.atSwitch && good.atSwitch.version === N1 && good.atSwitch.n_cache_still_there && good.atSwitch.n1_cache_files === nextManifest.files.length, good.atSwitch);
  check("after the switch only N+1's cache is left", (await good.caches.keys()).filter((k) => k.startsWith("px-release-")).join() === good.releaseCacheName(N1));
  check("the laptop's meta names N+1", (await good.db.getMeta(good.META_KEYS.release))?.manifest_sha256 === nextManifest.manifest_sha256);
  check("the person's records and queued edit are byte-for-byte the same", good.before === good.after);

  const changed = nextManifest.files.find((f) => prevManifest.files.find((p) => p.path === f.path)?.sha256 !== f.sha256);
  const bad = await run(changed.path);
  check("a live file altered on the way is refused", bad.result.status === "failed" && bad.result.reason === "file_hash", bad.result);
  check("refused: nothing switched, N's cache and meta stay", bad.atSwitch === null && (await bad.caches.keys()).filter((k) => k.startsWith("px-release-")).join() === bad.releaseCacheName(bad.N) && (await bad.db.getMeta(bad.META_KEYS.release))?.version === bad.N);
  check("refused: the person's records and queued edit are untouched", bad.before === bad.after);
  return { ok: steps.every((s) => s.ok), from: good.N, to: N1, steps };
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`release-registry-live: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  });
}
