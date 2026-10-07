import { describe, expect, test } from "bun:test"
import { OAUTH_BASE, OAUTH_ISSUER } from "@/lib/connectors/consent"
import { GET } from "./route"

// RFC 8414 metadata that AI tools read before they sign a person in. The sign-in service (compliance-tracker) serves the same document.
describe("/.well-known/oauth-authorization-server", () => {
  test("names this site as issuer and the sign-in service's endpoints; S256 only; public clients", async () => {
    const res = GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({
      issuer: OAUTH_ISSUER,
      authorization_endpoint: `${OAUTH_BASE}/authorize`,
      token_endpoint: `${OAUTH_BASE}/token`,
      registration_endpoint: `${OAUTH_BASE}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["projexa"],
    })
  })
})
