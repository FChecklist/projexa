/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { signRelease, verifyRelease, type TrustedReleaseKey } from "./signed-manifest"
import { planPublish, planRollback, prunable, publicBase } from "./storage-plan"

const manifest = { release_version: "2026.10.06-001", manifest_sha256: "a".repeat(64) }

async function keypair(kid: string) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
  const priv = await crypto.subtle.exportKey("jwk", pair.privateKey)
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey)
  return { kid, priv, trusted: { kid, jwk: pub } as TrustedReleaseKey }
}

describe("signed release manifest", () => {
  test("a release signed by the pinned key verifies", async () => {
    const k = await keypair("k1")
    const doc = await signRelease(manifest, { kid: "k1", privateJwk: k.priv })
    expect(await verifyRelease(manifest, doc, [k.trusted])).toEqual({ ok: true, kid: "k1" })
  })

  test("another digest, a tampered signature, an unpinned key, a forged key and junk are all refused", async () => {
    const k = await keypair("k1")
    const other = await keypair("k2")
    const doc = await signRelease(manifest, { kid: "k1", privateJwk: k.priv })
    expect(await verifyRelease({ ...manifest, manifest_sha256: "b".repeat(64) }, doc, [k.trusted])).toEqual({ ok: false, reason: "mismatch" })
    const flipped = { ...doc, sig: (doc.sig[0] === "A" ? "B" : "A") + doc.sig.slice(1) }
    expect((await verifyRelease(manifest, flipped, [k.trusted])).ok).toBe(false)
    expect(await verifyRelease(manifest, doc, [other.trusted])).toEqual({ ok: false, reason: "unknown_key" })
    // someone with write access to the bucket signs with their own key but claims the pinned kid
    const forged = await signRelease(manifest, { kid: "k1", privateJwk: other.priv })
    expect(await verifyRelease(manifest, forged, [k.trusted])).toEqual({ ok: false, reason: "bad_signature" })
    expect(await verifyRelease(manifest, { nope: 1 }, [k.trusted])).toEqual({ ok: false, reason: "malformed" })
    expect(await verifyRelease(manifest, doc, [])).toEqual({ ok: false, reason: "unknown_key" })
  })
})

describe("storage plan", () => {
  const files = [
    { path: "_release/release.json", bytes: 10 },
    { path: "_release/release.sig.json", bytes: 5 },
    { path: "_release/px-2026.10.06-001.tar.gz", bytes: 1000 },
    { path: "_next/static/chunks/a.js", bytes: 7 },
  ]

  test("mutable pointers are no-cache, content-addressed files immutable, rollback copies kept", () => {
    const plan = planPublish(files, "2026.10.06-001")
    expect(plan.find((p) => p.key === "_release/release.json")!.cacheControl).toBe("no-cache")
    expect(plan.find((p) => p.key === "_next/static/chunks/a.js")!.cacheControl).toContain("immutable")
    expect(plan.map((p) => p.key)).toContain("_release/releases/2026.10.06-001/release.json")
  })

  test("rollback rewrites exactly the two mutable keys from the kept copies", () => {
    expect(planRollback("2026.10.05-990").map((p) => [p.key, p.source])).toEqual([
      ["_release/release.json", "_release/releases/2026.10.05-990/release.json"],
      ["_release/release.sig.json", "_release/releases/2026.10.05-990/release.sig.json"],
    ])
  })

  test("refuses traversal, never prunes the newest two, public base is the storage URL", () => {
    expect(() => planPublish([{ path: "../x", bytes: 1 }], "v")).toThrow()
    expect(prunable(["c", "b", "a"], 1)).toEqual(["a"])
    expect(publicBase("abc", "projexa-release")).toBe("https://abc.supabase.co/storage/v1/object/public/projexa-release")
  })
})
