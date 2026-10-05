// AUDIT-100 B60 -- READ-ONLY evidence that the free Cloudflare Pages project serves PROJEXA's static files EXACTLY as the release
// registry recorded them, with the headers the laptops need. Run by hand, never in CI (network + a Supabase access token):
//
//   SUPABASE_ACCESS_TOKEN=... bun scripts/verify/static-pages-live.mjs [--host https://projexa-static.pages.dev] [--sample 0] [--require-registered]
//
// --sample N checks N files spread over the release (0 = every file). Writes ai-os/audit37/evidence/static-pages-<utc>.json and
// exits 0 only when every check passed. Nothing is written anywhere else; no login, no cookie, no deploy.
//
//   1. the host's /_release/release.json is self-consistent (its digest), is EXACTLY the release the live app origin serves (the one the
//      registry registers: POST /release/register makes the SERVER fetch release.json from the app origin), and -- once the registry has
//      registered it (registration is lazy: the first signed-in laptop that asks) -- has the registry's digest and file rows one for one.
//      --require-registered makes "not registered yet" a failure instead of a note;
//   2. every checked file is downloaded from the host and its sha256 and size equal the REGISTERED ones (or, before registration,
//      the live app origin's manifest's, which is what will be registered); the one bundle too;
//   3. headers, asked with Origin: https://projexa-ai.com as the app's pages ask: Access-Control-Allow-Origin allows the app,
//      /_next/static/** and the bundle are immutable, release.json is revalidated, a script is served as JavaScript, a missing
//      path is a real 404 (not Pages' single-page fallback), and the CORS preflight-free install fetch (?px-install=1) is served.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson, sha256Hex, PROJECT_REF } from "./release-registry-live.mjs";

const ROOT = join(import.meta.dir ?? dirname(new URL(import.meta.url).pathname), "..", "..");
const APP_ORIGIN = "https://projexa-ai.com";

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

const sleep = (n) => new Promise((r) => setTimeout(r, n));

async function get(host, path, headers = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${host}${path}`, { cache: "no-store", redirect: "manual", headers: { origin: APP_ORIGIN, "user-agent": "projexa-audit-b60-readonly", ...headers } });
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, bytes, headers: Object.fromEntries(res.headers.entries()) };
    } catch (err) {
      if (attempt === 3) return { status: 0, bytes: new Uint8Array(), headers: {}, error: String(err) };
      await sleep(1000 * attempt);
    }
  }
}

async function main() {
  const started = new Date().toISOString();
  const host = String(arg("host", "https://projexa-static.pages.dev")).replace(/\/+$/, "");
  const sample = Number(arg("sample", 0));
  const evidence = { kind: "AUDIT-100 B60 static host live evidence", started, host, app_origin: APP_ORIGIN, project_ref: PROJECT_REF, checks: {} };
  const fail = [];

  // 1. the manifest against the registry
  const m = await get(host, "/_release/release.json");
  const manifest = JSON.parse(new TextDecoder().decode(m.bytes));
  const { manifest_sha256: claimed, ...body } = manifest;
  const version = String(manifest.release_version).replace(/[^0-9.-]/g, "");
  const [reg] = await sql(`select release_version, manifest_sha256, git_sha, built_at, bundle_path, bundle_size, bundle_sha256, files_count from platform.projexa_release where release_version = '${version}'`);
  const regFiles = await sql(`select path, file_no, file_version, sha256, size from platform.projexa_release_file where release_version = '${version}' order by file_no`);
  const [top] = await sql("select release_version from platform.projexa_release order by built_at desc, release_version desc limit 1");
  const regByPath = new Map(regFiles.map((f) => [f.path, f]));
  const app = await get(APP_ORIGIN, "/_release/release.json");
  const appManifest = app.status === 200 ? JSON.parse(new TextDecoder().decode(app.bytes)) : null;
  const requireRegistered = Boolean(arg("require-registered", false));
  const manifestCheck = {
    status: m.status,
    release_version: manifest.release_version,
    digest_self_consistent: sha256Hex(canonicalJson(body)) === claimed,
    app_origin_release: appManifest?.release_version ?? null,
    same_as_app_origin: Boolean(appManifest) && appManifest.manifest_sha256 === claimed && sha256Hex(app.bytes) === sha256Hex(m.bytes),
    registered: Boolean(reg),
    registry_digest_equal: Boolean(reg) && reg.manifest_sha256 === claimed,
    registry_current_release: top?.release_version ?? null,
    is_registry_current: top?.release_version === manifest.release_version,
    registry_files_equal_manifest:
      regFiles.length === manifest.files.length && manifest.files.every((f) => regByPath.get(f.path)?.sha256 === f.sha256 && Number(regByPath.get(f.path)?.size) === f.size),
    files_in_release: manifest.files.length,
  };
  evidence.checks.manifest = manifestCheck;
  if (!reg) manifestCheck.note = "this release is not registered yet (lazy: the first signed-in laptop that asks registers it); bytes are checked against the manifest the app origin serves, which is what will be registered";
  const registryOk = reg ? manifestCheck.registry_digest_equal && manifestCheck.registry_files_equal_manifest : !requireRegistered;
  if (m.status !== 200 || !manifestCheck.digest_self_consistent || !manifestCheck.same_as_app_origin || !registryOk) fail.push("manifest");
  // the reference each file is checked against: the registry's rows when registered, else the (digest-verified) manifest itself
  const refByPath = reg ? regByPath : new Map(manifest.files.map((f) => [f.path, f]));
  const refBundle = reg ? { sha256: reg.bundle_sha256, size: Number(reg.bundle_size) } : manifest.bundle;

  // 2. the bytes against the registry
  const servable = manifest.files.filter((f) => f.path !== "_shell/local.html"); // an app page, served by the app origin at /local
  const picked = sample > 0 ? servable.filter((_, i) => i % Math.max(1, Math.floor(servable.length / sample)) === 0).slice(0, sample) : servable;
  const files = { checked: 0, bytes: 0, bad: [], shell_not_on_host: null };
  for (const f of picked) {
    const r = refByPath.get(f.path);
    const got = await get(host, `/${f.path}`);
    files.checked += 1;
    files.bytes += got.bytes.length;
    const hash = sha256Hex(got.bytes);
    if (got.status !== 200 || !r || hash !== r.sha256 || got.bytes.length !== Number(r.size)) files.bad.push({ path: f.path, status: got.status, size: got.bytes.length, sha256: hash, registered: r ? { sha256: r.sha256, size: Number(r.size) } : null });
    await sleep(15);
  }
  const bundle = await get(host, `/${manifest.bundle.path}`);
  files.reference = reg ? "registry" : "app-origin manifest (not registered yet)";
  files.bundle = { path: manifest.bundle.path, status: bundle.status, size: bundle.bytes.length, sha256_equal_reference: sha256Hex(bundle.bytes) === refBundle.sha256 && bundle.bytes.length === Number(refBundle.size) };
  files.shell_not_on_host = (await get(host, "/_shell/local.html")).status === 404;
  evidence.checks.files = files;
  if (files.bad.length || !files.bundle.sha256_equal_reference || !files.shell_not_on_host) fail.push("files");

  // 3. headers
  const js = servable.find((f) => f.path.startsWith("_next/static/") && f.path.endsWith(".js"));
  const font = servable.find((f) => f.path.endsWith(".woff2"));
  const h = async (path) => {
    const r = await get(host, path);
    const pick = (k) => r.headers[k] ?? null;
    return { path, status: r.status, acao: pick("access-control-allow-origin"), cache_control: pick("cache-control"), content_type: pick("content-type") };
  };
  const headers = {
    js: js ? await h(`/${js.path}`) : null,
    js_install_fetch: js ? await h(`/${js.path}?px-install=1`) : null,
    font: font ? await h(`/${font.path}`) : null,
    bundle: await h(`/${manifest.bundle.path}`),
    manifest: await h("/_release/release.json"),
    public_file: await h("/logo-mark.svg"),
    missing: await h("/_next/static/chunks/does-not-exist-b60.js"),
  };
  const acaoOk = (x) => x && (x.acao === "*" || x.acao === APP_ORIGIN);
  const immutable = (x) => x && /max-age=31536000/.test(x.cache_control ?? "") && /immutable/.test(x.cache_control ?? "") && !/no-cache|must-revalidate|max-age=0/.test(x.cache_control ?? "");
  const verdict = {
    cors_on_every_kind: [headers.js, headers.js_install_fetch, headers.font, headers.bundle, headers.manifest, headers.public_file].filter(Boolean).every(acaoOk),
    code_and_bundle_immutable: immutable(headers.js) && immutable(headers.bundle) && (!headers.font || immutable(headers.font)),
    manifest_revalidated: /no-cache/.test(headers.manifest.cache_control ?? "") && !/immutable/.test(headers.manifest.cache_control ?? ""),
    js_is_javascript: Boolean(headers.js && /javascript/.test(headers.js.content_type ?? "")),
    install_fetch_served: Boolean(headers.js_install_fetch && headers.js_install_fetch.status === 200),
    missing_is_404: headers.missing.status === 404,
  };
  evidence.checks.headers = { ...headers, verdict };
  if (!Object.values(verdict).every(Boolean)) fail.push("headers");

  evidence.finished = new Date().toISOString();
  evidence.ok = fail.length === 0;
  evidence.failed = fail;
  const out = join(ROOT, "ai-os", "audit37", "evidence", `static-pages-${started.replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(evidence, null, 1)}\n`);
  console.log(JSON.stringify({ ok: evidence.ok, failed: fail, out, manifest: manifestCheck, files: { checked: files.checked, bytes: files.bytes, bad: files.bad.length, bundle: files.bundle }, verdict }, null, 1));
  process.exit(evidence.ok ? 0 : 1);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`static-pages-live: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  });
}
