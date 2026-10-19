// Login cookies belong to ONE host. projexa-ai.com and www.projexa-ai.com both serve the app, so a person who
// signed in on one and later typed the other looked signed out and was asked for the password again. Everything
// is sent to the apex, which is also Supabase's configured site_url, so there is exactly one cookie jar.
const APEX = "projexa-ai.com";

/** The apex URL to send this request to, or null when it is already on the right host. */
export function canonicalHostRedirect(url: URL): URL | null {
  if (url.hostname.toLowerCase() !== `www.${APEX}`) return null;
  const target = new URL(url.href);
  target.hostname = APEX;
  return target;
}
