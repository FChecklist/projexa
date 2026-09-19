import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { pushDataToSheet } from "@/lib/google-sheets/push";
import { withTiming } from "@/lib/with-timing";

// Session-authed "Push to sheet now" button inside the app itself --
// belt-and-suspenders alongside the in-sheet "Refresh Data" menu item,
// for a user who is already in PROJEXA and doesn't want to switch tabs.
export const POST = withTiming("POST", async function POST() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    await pushDataToSheet(ctx.organizationId!);
    return NextResponse.json({ refreshed: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to refresh the sheet" }, { status: 502 });
  }
});
