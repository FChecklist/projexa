import { NextResponse } from "next/server";
import { OAUTH_BASE, OAUTH_ISSUER } from "@/lib/connectors/consent";

// RFC 8414 metadata for "Sign in with PROJEXA". The issuer is this site; the endpoints are the sign-in service
// (compliance-tracker supabase/functions/projexa-oauth), which serves the same document at its own address.
export function GET() {
  return NextResponse.json(
    {
      issuer: OAUTH_ISSUER,
      authorization_endpoint: `${OAUTH_BASE}/authorize`,
      token_endpoint: `${OAUTH_BASE}/token`,
      registration_endpoint: `${OAUTH_BASE}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["projexa"],
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
