// AUDIT-100 B6/B56: where to send a person after they sign in.
//
// /invite/<token> sends a signed-out visitor to /login?redirectTo=/invite/<token> ("you will come straight back here"), and the middleware
// sends anyone who opens a signed-in page while signed out to /login?redirectTo=<that page>. The login form used to ignore that parameter and
// always went to /dashboard, so an invited person who had to sign in first never came back to the invitation and was never attached to the
// organisation (found by e2e/audit37-real-b6-b56-invite.spec.ts against the real backend).
//
// Only a same-origin PATH is ever accepted, so a crafted link cannot turn the sign-in page into an open redirect: "//evil.example",
// "/\evil.example" (browsers read a backslash as a slash), "https://evil.example", "javascript:..." and anything with control characters all fall
// back to the default. /login and /signup themselves fall back too, so a sign-in can never loop back onto the form it just left.
export function safeRedirectPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof raw !== "string") return fallback;
  const target = raw.trim();
  if (!target.startsWith("/")) return fallback;
  if (target.startsWith("//") || target.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(target)) return fallback;
  const path = target.split(/[?#]/)[0];
  if (path === "/login" || path.startsWith("/login/") || path === "/signup" || path.startsWith("/signup/")) return fallback;
  return target;
}
