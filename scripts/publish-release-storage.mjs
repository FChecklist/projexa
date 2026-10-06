// RELEASE DISTRIBUTION: publishes one staged release (scripts/stage-static-pages.mjs --out <dir>) to a PUBLIC Supabase Storage bucket,
// signed. DRY RUN BY DEFAULT: without --apply nothing is signed with a real key and nothing leaves this machine.
//
//   bun scripts/publish-release-storage.mjs --staged <dir> [--project-ref <ref>] [--bucket projexa-release]          dry run, prints the plan
//   bun scripts/publish-release-storage.mjs --staged <dir> --apply         signs with PX_RELEASE_SIGNING_JWK (+PX_RELEASE_KID), uploads
//   bun scripts/publish-release-storage.mjs --rollback <version> [--apply]  rewrites release.json + release.sig.json from the kept copy
//
// --apply needs SUPABASE_SERVICE_ROLE_KEY in the environment (never printed). Immutable objects are uploaded with x-upsert false (an
// existing key is a refusal, not an overwrite); only the two mutable pointers are upserted. Design: ai-os/audit37/RELEASE_DISTRIBUTION_2026-10-06.md

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { signRelease, SIGNATURE_FILE } from "../src/lib/release-dist/signed-manifest.ts"
import { planPublish, planRollback, publicBase } from "../src/lib/release-dist/storage-plan.ts"

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, base, out)
    else out.push({ path: relative(base, p).split(sep).join("/"), bytes: statSync(p).size })
  }
  return out
}

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const apply = process.argv.includes("--apply")
const ref = arg("project-ref", "pcrjmlpuqsbocqfwoxod")
const bucket = arg("bucket", "projexa-release")

async function put(obj, bytes) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set")
  const res = await fetch(`https://${ref}.supabase.co/storage/v1/object/${bucket}/${obj.key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "cache-control": obj.cacheControl.replace("public, ", ""), "x-upsert": obj.mutable ? "true" : "false", "content-type": obj.key.endsWith(".json") ? "application/json" : "application/octet-stream" },
    body: bytes,
  })
  if (!res.ok) throw new Error(`upload ${obj.key} -> ${res.status}`)
}

if (process.argv[1].endsWith("publish-release-storage.mjs")) {
  const rollback = arg("rollback")
  if (rollback) {
    const plan = planRollback(rollback)
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", base: publicBase(ref, bucket), plan }, null, 1))
    if (apply) throw new Error("rollback --apply copies server-side in a later slice; run the dry-run plan by hand for now")
  } else {
    const dir = arg("staged")
    if (!dir) throw new Error("--staged <dir> is required")
    const files = walk(dir)
    const manifest = JSON.parse(readFileSync(join(dir, "_release/release.json"), "utf8"))
    const plan = planPublish([...files, { path: SIGNATURE_FILE, bytes: 0 }], manifest.release_version)
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", base: publicBase(ref, bucket), release_version: manifest.release_version, objects: plan.length, bytes: files.reduce((n, f) => n + f.bytes, 0) }, null, 1))
    if (apply) {
      const sig = await signRelease(manifest, { kid: process.env.PX_RELEASE_KID ?? "k1", privateJwk: JSON.parse(process.env.PX_RELEASE_SIGNING_JWK ?? "null") })
      const sigBytes = Buffer.from(JSON.stringify(sig))
      // immutable first (bundle, static files, per-version copies), the two mutable pointers LAST so a laptop never sees a pointer to a missing file
      const ordered = [...plan.filter((p) => !p.mutable), ...plan.filter((p) => p.mutable)]
      for (const obj of ordered) await put(obj, obj.source === SIGNATURE_FILE || obj.source.endsWith("release.sig.json") ? sigBytes : readFileSync(join(dir, obj.source)))
    }
  }
}
