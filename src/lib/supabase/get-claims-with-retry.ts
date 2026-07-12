import type { SupabaseClient } from "@supabase/supabase-js";

// A single transient network failure talking to Supabase Auth (confirmed
// live during investigation: the Next.js Edge runtime's sandboxed fetch can
// intermittently throw ConnectTimeoutError reaching Supabase's edge) must
// not be treated as "the user is logged out" -- that was the actual root
// cause of PROJEXA's random mid-session logouts and silent write failures.
// getClaims() already avoids the network in the common case (local JWT
// verification against a cached JWKS), so the calls that do hit the network
// (a cold JWKS fetch, or a due token refresh) are rare enough that one retry
// is cheap and removes most of the remaining exposure.
export async function getClaimsWithRetry(supabase: SupabaseClient) {
  const first = await supabase.auth.getClaims();
  if (!first.error) return first;

  const isLikelyNetworkError = /fetch failed|network|timeout|ECONNRESET|ETIMEDOUT/i.test(first.error.message);
  if (!isLikelyNetworkError) return first;

  console.warn("[supabase] getClaims() failed once, retrying:", first.error.message);
  return supabase.auth.getClaims();
}
