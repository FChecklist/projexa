/// <reference types="bun-types" />
// Release signing end to end: make-release.mjs signs with a key from PX_RELEASE_SIGNING_KEY (PEM, base64 PEM or JWK), the laptop-side verifier accepts
// it under the pinned public key, and the REAL pinned key refuses anything signed by another key.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { buildRelease, signManifest } from "../../../scripts/make-release.mjs"
import { BUILTIN_RELEASE_KEYS, PINNED_RELEASE_KEYS, mergePinnedKeys, normalizeRequiredFrom, signatureRequired } from "./pinned-keys"
import { verifyRelease, type TrustedReleaseKey } from "./signed-manifest"

let root = ""
const NOW = new Date("2026-10-08T09:30:00.000Z")

function put(path: string, content: string) {
  const full = join(root, ...path.split("/"))
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}
function testKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const j = publicKey.export({ format: "jwk" })
  return { pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), trusted: { kid, jwk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y } } as TrustedReleaseKey }
}
const readSig = () => JSON.parse(readFileSync(join(root, "public", "_release", "release.sig.json"), "utf8"))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "px-sign-"))
  put(".next/static/chunks/app.js", "console.log(1)")
  put("public/logo.svg", "<svg/>")
  put("src/lib/local-first/local-db.ts", "export const LOCAL_DB_VERSION = 3;\n")
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("signing at build time", () => {
  test("a release built with a key in PX_RELEASE_SIGNING_KEY gets a release.sig.json the pinned-key verifier accepts (PEM and base64 PEM)", async () => {
    const k = testKey("t1")
    for (const form of [k.pem, Buffer.from(k.pem).toString("base64")]) {
      const logs: string[] = []
      const r = buildRelease({ root, env: { PX_RELEASE_SIGNING_KEY: form, PX_RELEASE_KID: "t1", BUILD_NUMBER: "5" }, now: NOW, log: (l: string) => logs.push(l) })
      expect(logs.join("\n")).toContain("signed with key t1")
      expect(await verifyRelease(r.manifest, readSig(), [k.trusted])).toEqual({ ok: true, kid: "t1" })
    }
  })

  test("without the secret the build still succeeds, says it is NOT signed, and leaves no stale signature from an older release", () => {
    const k = testKey("t1")
    buildRelease({ root, env: { PX_RELEASE_SIGNING_KEY: k.pem, PX_RELEASE_KID: "t1" }, now: NOW })
    expect(existsSync(join(root, "public", "_release", "release.sig.json"))).toBe(true)
    const logs: string[] = []
    buildRelease({ root, env: {}, now: new Date("2026-10-08T10:30:00.000Z"), log: (l: string) => logs.push(l) })
    expect(logs.join("\n")).toContain("NOT signed")
    expect(existsSync(join(root, "public", "_release", "release.sig.json"))).toBe(false)
  })

  test("a tampered manifest, a wrong key and a different pinned key are refused; rotation (old + new pinned) accepts both", async () => {
    const a = testKey("old")
    const b = testKey("new")
    const r = buildRelease({ root, env: { PX_RELEASE_SIGNING_KEY: a.pem, PX_RELEASE_KID: "old" }, now: NOW })
    const sig = readSig()
    expect((await verifyRelease({ ...r.manifest, manifest_sha256: "0".repeat(64) }, sig, [a.trusted])).ok).toBe(false)
    expect(await verifyRelease(r.manifest, sig, [{ kid: "old", jwk: b.trusted.jwk }])).toEqual({ ok: false, reason: "bad_signature" })
    expect(await verifyRelease(r.manifest, sig, [b.trusted])).toEqual({ ok: false, reason: "unknown_key" })
    expect(await verifyRelease(r.manifest, sig, [a.trusted, b.trusted])).toEqual({ ok: true, kid: "old" })
    const doc = signManifest(r.manifest, (await import("node:crypto")).createPrivateKey(b.pem), "new")
    expect(await verifyRelease(r.manifest, doc, [a.trusted, b.trusted])).toEqual({ ok: true, kid: "new" })
  })
})

describe("the real pinned key", () => {
  test("it is built in, is a public ES256 key with no private part, and a signature by any other key is refused", async () => {
    expect(BUILTIN_RELEASE_KEYS.map((k) => k.kid)).toEqual(["px-release-2026-10-08"])
    expect(PINNED_RELEASE_KEYS.some((k) => k.kid === "px-release-2026-10-08")).toBe(true)
    for (const k of PINNED_RELEASE_KEYS) expect((k.jwk as { d?: unknown }).d).toBeUndefined()
    const impostor = testKey("px-release-2026-10-08") // same kid, different key
    const manifest = { release_version: "2026.10.08-100", manifest_sha256: "c".repeat(64) }
    const forged = signManifest(manifest, (await import("node:crypto")).createPrivateKey(impostor.pem), "px-release-2026-10-08")
    expect(await verifyRelease(manifest, forged, PINNED_RELEASE_KEYS)).toEqual({ ok: false, reason: "bad_signature" })
    const other = signManifest(manifest, (await import("node:crypto")).createPrivateKey(impostor.pem), "someone-else")
    expect(await verifyRelease(manifest, other, PINNED_RELEASE_KEYS)).toEqual({ ok: false, reason: "unknown_key" })
  })

  test("key list merge keeps the first entry of a kid; signature_required_from only enforces from that version on", () => {
    const a = testKey("x").trusted
    const b = { kid: "x", jwk: testKey("x").trusted.jwk }
    expect(mergePinnedKeys([a], [b])).toEqual([a])
    expect(normalizeRequiredFrom("garbage")).toBe("")
    expect(signatureRequired("2099.01.01-001", "")).toBe(false)
    expect(signatureRequired("2026.10.08-099", "2026.10.08-100")).toBe(false)
    expect(signatureRequired("2026.10.08-100", "2026.10.08-100")).toBe(true)
  })
})
