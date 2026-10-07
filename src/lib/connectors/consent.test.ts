import { describe, expect, test } from "bun:test"
import { decodeConsentPayload, denyAddress, safeReturnAddress, tokenFromLink } from "./consent"

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
const CHALLENGE = "a".repeat(43)
const good = { c: "px_" + "0f".repeat(12), r: "https://claude.ai/api/mcp/auth_callback", s: "st", h: CHALLENGE, n: "Claude" }

describe("the consent request", () => {
  test("a good request is decoded", () => {
    expect(decodeConsentPayload(b64url(good))).toEqual({ clientId: good.c, redirectUri: good.r, state: "st", codeChallenge: CHALLENGE, clientName: "Claude" })
  })

  test("anything off is refused, never shown", () => {
    for (const bad of [
      { ...good, c: "nope" },
      { ...good, r: "http://evil.example/cb" },
      { ...good, r: "javascript:alert(1)" },
      { ...good, h: "short" },
    ]) expect(decodeConsentPayload(b64url(bad))).toBeNull()
    expect(decodeConsentPayload("%%%not-base64")).toBeNull()
    expect(decodeConsentPayload(Buffer.from("not json").toString("base64url"))).toBeNull()
  })

  test("a missing name falls back to a plain one, a long state is cut", () => {
    const r = decodeConsentPayload(b64url({ ...good, n: "   ", s: "x".repeat(900) }))!
    expect(r.clientName).toBe("An AI assistant")
    expect(r.state.length).toBe(500)
  })

  test("a name written in other scripts survives", () => {
    expect(decodeConsentPayload(Buffer.from(JSON.stringify({ ...good, n: "सहायक" })).toString("base64url"))!.clientName).toBe("सहायक")
  })

  test("return addresses: https, or http on this computer only", () => {
    expect(safeReturnAddress("https://chatgpt.com/connector/oauth/abc")).toBe(true)
    expect(safeReturnAddress("http://localhost:6274/oauth/callback")).toBe(true)
    expect(safeReturnAddress("http://example.com/cb")).toBe(false)
    expect(safeReturnAddress("https://a.example/cb#x")).toBe(false)
  })
})

describe("the link and the refusal", () => {
  test("the token is found inside a minted link address", () => {
    const t = "pxa_" + "ab".repeat(32)
    expect(tokenFromLink(`https://x.supabase.co/functions/v1/ai-work-link/${t}`)).toBe(t)
    expect(tokenFromLink("https://x/none")).toBeNull()
  })

  test("saying no sends back access_denied with the state", () => {
    const u = new URL(denyAddress({ clientId: good.c, redirectUri: good.r, state: "st", codeChallenge: CHALLENGE, clientName: "Claude" }))
    expect(u.searchParams.get("error")).toBe("access_denied")
    expect(u.searchParams.get("state")).toBe("st")
    expect(u.searchParams.get("code")).toBeNull()
  })
})
