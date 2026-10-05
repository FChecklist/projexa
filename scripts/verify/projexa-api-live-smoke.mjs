// AUDIT-100 A2, LIVE SMOKE: the same request, as the same real person, through the deployed Supabase Edge Function projexa-api and through
// PROJEXA's Vercel /api route, must give the same answer (status and JSON, volatile time fields aside).
//
//   PROJEXA_SERVICE_ROLE_KEY=... PROJEXA_ANON_KEY=... node scripts/verify/projexa-api-live-smoke.mjs
//
// TEST ORGANISATION ONLY: a session is minted (admin magic link + verify, no email is sent, no password is used) only for an address of the
// E2E test org (*.e2e-test.projexa-ai.com, e2e/users.ts). Nothing writes data: the writes probed are role refusals (the gate answers 403
// before any handler runs) and an unknown id (the backend answers 404 before writing). Batch 2 (AUDIT-100 A2) adds every GET of the batch as
// the owner and as client_viewer, and checks the deployed policy hash equals this checkout's. Nothing prints a key, a token or an email.
// Exit 0 = every probe identical.

const PROJEXA = process.env.PROJEXA_SUPABASE_URL ?? "https://evpckeuxgvahguwsaeul.supabase.co";
const EDGE = process.env.PX_API_EDGE_URL ?? "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api";
const SYNC = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync";
const VERCEL = process.env.PX_VERCEL_ORIGIN ?? "https://projexa-ai.com";
const SERVICE = process.env.PROJEXA_SERVICE_ROLE_KEY ?? "";
const ANON = process.env.PROJEXA_ANON_KEY ?? "";
const TEST_ORG = /@meridian-construction\.e2e-test\.projexa-ai\.com$/;
const PEOPLE = {
  owner: "arjun.mehta@meridian-construction.e2e-test.projexa-ai.com",
  pm: "deepak.joshi@meridian-construction.e2e-test.projexa-ai.com",
  client_viewer: "karan.malhotra@meridian-construction.e2e-test.projexa-ai.com",
};
const UNKNOWN = "00000000-0000-4000-8000-00000000a2a2";

if (!SERVICE || !ANON) {
  console.error("set PROJEXA_SERVICE_ROLE_KEY and PROJEXA_ANON_KEY (never printed)");
  process.exit(2);
}

async function retry(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function mintSession(email) {
  if (!TEST_ORG.test(email)) throw new Error("test organisation only");
  const link = await retry(() =>
    fetch(`${PROJEXA}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", email }) }),
  );
  if (!link.ok) throw new Error(`generate_link ${link.status}`);
  const raw = await link.json();
  const hashed = raw?.hashed_token ?? raw?.properties?.hashed_token ?? null; // GoTrue answers it at the top level; supabase-js nests it
  if (!hashed) throw new Error("no hashed_token");
  const v = await retry(() => fetch(`${PROJEXA}/auth/v1/verify`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: hashed }) }));
  if (!v.ok) throw new Error(`verify ${v.status}`);
  return v.json();
}

/** @supabase/ssr's cookie: "base64-" + base64url(JSON), split into .0/.1/... chunks of 3180 characters when long. */
function sessionCookie(session) {
  const name = `sb-${new URL(PROJEXA).host.split(".")[0]}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  if (value.length <= 3180) return `${name}=${value}`;
  const parts = [];
  for (let i = 0, n = 0; i < value.length; i += 3180, n++) parts.push(`${name}.${n}=${value.slice(i, i + 3180)}`);
  return parts.join("; ");
}

const VOLATILE = /(At|_at|Time|_time|timestamp|fetched|generated)$/i;
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.test(k)).map(([k, x]) => [k, normalize(x)]));
  return v;
}

async function call(base, path, init) {
  const res = await retry(() => fetch(`${base}${path}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(70_000) }));
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { __not_json__: text.slice(0, 60) };
  }
  return { status: res.status, body: normalize(body) };
}

const results = [];
async function probe(label, who, session, method, path, body) {
  const json = body === undefined ? {} : { "Content-Type": "application/json" };
  const init = (h) => ({ method, headers: { ...json, ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
  const [edge, vercel] = await Promise.all([
    call(EDGE, path, init({ Authorization: `Bearer ${session.access_token}`, Origin: VERCEL })),
    call(VERCEL, path, init({ Cookie: sessionCookie(session) })),
  ]);
  const same = edge.status === vercel.status && JSON.stringify(edge.body) === JSON.stringify(vercel.body);
  results.push({ label, who, method, path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id"), edge: edge.status, vercel: vercel.status, same });
  if (!same) console.log(`DIFF ${label} as ${who}: edge ${edge.status} ${JSON.stringify(edge.body).slice(0, 300)} | vercel ${vercel.status} ${JSON.stringify(vercel.body).slice(0, 300)}`);
}

const sessions = {};
for (const [who, email] of Object.entries(PEOPLE)) sessions[who] = await mintSession(email);

// a real project of the test organisation, from the sync service's manifest (as the owner)
const manifest = await (await retry(() => fetch(`${SYNC}/manifest`, { headers: { Authorization: `Bearer ${sessions.owner.access_token}`, "x-px-client": "a2-smoke; protocol=2; schema=3" } }))).json();
const projectId = manifest?.projects?.[0]?.id;
if (!projectId) throw new Error("the test organisation has no project");

const policy = await (await fetch(`${EDGE}/_policy`)).json();
console.log(`edge policy ${policy.source_sha256} routes=${policy.routes?.length}`);
// the deployed table must be THIS checkout's generated one (same hash, same routes)
{
  const { readFileSync } = await import("node:fs");
  const local = readFileSync(new URL("../../ai-os/audit37/projexa-api/policy.generated.ts", import.meta.url), "utf8").match(/SOURCE_SHA256 = "([0-9a-f]{64})"/)?.[1];
  const routes = JSON.parse(readFileSync(new URL("../../ai-os/audit37/projexa-api-routes.json", import.meta.url), "utf8")).routes;
  results.push({ label: "deployed policy = this checkout's", who: "-", method: "GET", path: "/_policy", edge: policy.routes?.length, vercel: routes.length, same: policy.source_sha256 === local && policy.routes?.length === routes.length });
}

for (const who of ["owner", "pm", "client_viewer"]) {
  const s = sessions[who];
  await probe("dashboard snapshot", who, s, "GET", `/api/dashboard/project/${projectId}`);
  await probe("exceptions", who, s, "GET", `/api/exceptions?projectId=${projectId}`);
  await probe("BOQ analysis", who, s, "GET", `/api/reports/boq-analysis?projectId=${projectId}`);
  await probe("document (unknown id)", who, s, "GET", `/api/documents/${UNKNOWN}`);
  await probe("drawing file URL (unknown id)", who, s, "GET", `/api/drawings/${UNKNOWN}/document-url`);
  await probe("permit (unknown id)", who, s, "GET", `/api/permits/${UNKNOWN}`);
}
await probe("BOQ line edit refused by role", "client_viewer", sessions.client_viewer, "PATCH", `/api/scope/line-items/${UNKNOWN}`, { qtyProject: "1" });
await probe("BOQ line edit, unknown line", "pm", sessions.pm, "PATCH", `/api/scope/line-items/${UNKNOWN}`, { qtyProject: "1" });
await probe("permit edit refused by role", "client_viewer", sessions.client_viewer, "PATCH", `/api/permits/${UNKNOWN}`, { status: "approved" });
await probe("missing projectId", "pm", sessions.pm, "GET", `/api/exceptions`);
await probe("signed out", "nobody", { access_token: "x.y.z" }, "GET", `/api/exceptions?projectId=${projectId}`);

// AUDIT-100 A2 batches 2+: every GET of the batches (read-only), as the owner and as client_viewer; an :id route with an unknown id
{
  const { readFileSync } = await import("node:fs");
  const batch2 = JSON.parse(readFileSync(new URL("../../ai-os/audit37/projexa-api-routes.json", import.meta.url), "utf8")).routes.filter((r) => r.batch >= 2);
  for (const r of batch2) {
    const get = r.methods.GET;
    if (!get) continue;
    let path = r.route.replace(/:\w+/g, UNKNOWN);
    if (get.required_query) path += `?projectId=${projectId}`;
    else if (get.forward_search) path += "?limit=5";
    for (const who of ["owner", "client_viewer"]) await probe(`batch ${r.batch} read ${r.route}`, who, sessions[who], "GET", path);
  }
  // writes the role gate refuses before any handler runs (nothing is written): client_viewer creating a vendor, pm starting a payroll run
  await probe("batch 2: create vendor refused by role", "client_viewer", sessions.client_viewer, "POST", "/api/vendors", { vendorName: "a2 smoke (never written)" });
  await probe("batch 2: payroll run refused by role", "pm", sessions.pm, "POST", "/api/payroll/runs", { period: "2099-01" });
  await probe("batch 2: policy edit refused by role", "client_viewer", sessions.client_viewer, "PATCH", `/api/policies/${UNKNOWN}`, { title: "x" });
}

// deny by default: a real Vercel route the edge does not answer
const notListed = await call(EDGE, "/api/shell", { headers: { Authorization: `Bearer ${sessions.owner.access_token}` } });
results.push({ label: "deny by default (/api/shell)", who: "owner", method: "GET", path: "/api/shell", edge: notListed.status, vercel: "-", same: notListed.status === 404 });

console.table(results);
const bad = results.filter((r) => !r.same).length;
console.log(bad ? `${bad} probe(s) differ` : `all ${results.length} probes identical`);
process.exit(bad ? 1 : 0);
