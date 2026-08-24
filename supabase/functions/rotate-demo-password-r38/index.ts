import { createClient } from "jsr:@supabase/supabase-js@2";

// R38 Q1 (R-A1): rotate the demo admin password via Admin API, never typed
// or printed anywhere. Generates a fresh random password server-side inside
// this Edge Function (service-role key injected by the platform, never seen
// by the caller), calls admin.updateUserById, and returns ONLY a success
// boolean + user id -- the password itself never leaves this function.
//
// TC-R-A1-20260824: this is the git-tracked source of record for this
// function going forward (it previously existed only as a deployed
// function with no repo history -- see drizzle/0014_security_audit_log.sql
// for why). The only functional change from the version already live is
// the public.security_audit_log insert below: on a successful rotation it
// appends one row recording that a rotation happened, who/what triggered
// it, and when -- never the password itself -- so this requirement has a
// real, queryable audit trail instead of none.
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret !== "r38-rotate-2026") {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return new Response(JSON.stringify({ error: "userId is required" }), { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Cryptographically random, generated and consumed entirely inside this
  // function -- never returned, never logged.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const newPassword = "R38-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const { data, error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) {
    return new Response(JSON.stringify({ error: error.message, step: "updateUserById" }), { status: 500 });
  }

  // Audit trail -- fire-and-forget-safe (awaited, but a logging failure
  // does not unwind a rotation that already succeeded; it's reported back
  // to the caller as auditLogged: false instead).
  let auditLogged = true;
  const { error: auditError } = await admin
    .from("security_audit_log")
    .insert({
      event: "demo_password_rotated",
      target_user_id: data.user?.id ?? userId,
      target_email: data.user?.email ?? null,
      actor: "rotate-demo-password-r38",
      metadata: { trigger: "manual_invoke" },
    });
  if (auditError) {
    auditLogged = false;
  }

  return new Response(JSON.stringify({
    rotated: true,
    user_id: data.user?.id,
    email: data.user?.email,
    updated_at: data.user?.updated_at,
    auditLogged,
  }), { headers: { "Content-Type": "application/json" } });
});
