import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withTiming } from "@/lib/with-timing";

// Shows an invited person what they are being invited TO before they accept.
// Backed by public.org_invite_preview(), which returns the organisation name,
// the role and the expiry only -- never the token, the email, or anything
// else in the row.
export const GET = withTiming("GET", async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "An invitation token is required." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_invite_preview", { p_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: "This invitation link is not valid." }, { status: 404 });
  return NextResponse.json({ invite: row });
});
