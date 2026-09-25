// PROJEXA-BUILD-001 U-33. A stand-in for the Supabase Auth endpoints the PROJEXA app calls, used ONLY by the local browser-first BOQ
// specs (playwright.boq-local.config.ts). It lets a local PROJEXA server accept a synthetic signed-in browser without any real Supabase
// project, session, network or secret:
//   * a signing key pair is generated in memory when this process starts and is never written anywhere;
//   * the middleware's getClaims() verifies the session token against this server's key set (GET /auth/v1/.well-known/jwks.json);
//   * GET /__session returns a session cookie (name and value) for a made-up person, signed with that key, valid for one hour.
// It listens on loopback only. Nothing here can sign in to a real PROJEXA or VERIDIAN deployment: no real project trusts this key set.
import { createServer } from "node:http"
import { generateKeyPairSync, randomUUID, sign } from "node:crypto"

const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54399)
const ORIGIN = `http://localhost:${PORT}`
const ISSUER = `${ORIGIN}/auth/v1`
const KID = "local-boq-spec-key"

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "ES256", use: "sig", key_ops: ["verify"] }

const b64url = (input) => Buffer.from(input).toString("base64url")

function signJwt(payload) {
  const header = { alg: "ES256", typ: "JWT", kid: KID }
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signature = sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" })
  return `${data}.${b64url(signature)}`
}

function makeSession(email) {
  const userId = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 3600
  const user = {
    id: userId, aud: "authenticated", role: "authenticated", email, email_confirmed_at: new Date(now * 1000).toISOString(),
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: new Date(now * 1000).toISOString(),
    updated_at: new Date(now * 1000).toISOString(), is_anonymous: false,
  }
  const accessToken = signJwt({
    iss: ISSUER, sub: userId, aud: "authenticated", role: "authenticated", email, iat: now, exp: expiresAt,
    session_id: randomUUID(), aal: "aal1", amr: [{ method: "password", timestamp: now }], app_metadata: user.app_metadata, user_metadata: {}, is_anonymous: false,
  })
  const session = { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: expiresAt, refresh_token: "local-stub-refresh-token", user }
  // The cookie @supabase/ssr reads: "base64-" plus the session JSON, base64url encoded. Its name comes from the first label of the URL host.
  const cookieName = `sb-${new URL(ORIGIN).hostname.split(".")[0]}-auth-token`
  return { userId, email, accessToken, session, cookieName, cookieValue: `base64-${b64url(JSON.stringify(session))}` }
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*")
  res.setHeader("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-supabase-api-version")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  res.setHeader("Vary", "Origin")
}

function json(req, res, status, body) {
  cors(req, res)
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(body))
}

function userOfToken(req) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"))
  } catch {
    return null
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN)
  if (req.method === "OPTIONS") {
    cors(req, res)
    res.statusCode = 204
    res.end()
    return
  }
  if (url.pathname === "/health") return json(req, res, 200, { ok: true })
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return json(req, res, 200, { keys: [jwk] })
  if (url.pathname === "/__session") {
    const made = makeSession(url.searchParams.get("email") ?? "boq-spec@example.invalid")
    return json(req, res, 200, { userId: made.userId, email: made.email, accessToken: made.accessToken, cookieName: made.cookieName, cookieValue: made.cookieValue })
  }
  if (url.pathname === "/auth/v1/user") {
    const claims = userOfToken(req)
    if (!claims?.sub) return json(req, res, 401, { message: "invalid token" })
    return json(req, res, 200, { id: claims.sub, aud: "authenticated", role: "authenticated", email: claims.email ?? null, app_metadata: {}, user_metadata: {} })
  }
  if (url.pathname === "/auth/v1/token") {
    // A refresh: hand back a new session for the same made-up person.
    const made = makeSession("boq-spec@example.invalid")
    return json(req, res, 200, made.session)
  }
  return json(req, res, 404, { message: "not part of the local stub" })
})

server.listen(PORT, () => {
  console.log(`local Supabase Auth stand-in listening on ${ORIGIN}`)
})
