import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { withTiming } from "@/lib/with-timing";

// Real notification list + unread count, backing NotificationBell.tsx.
// Same Supabase-JS-client + RLS pattern as GET /api/todos and
// GET /api/org-members -- rows are scoped to the caller via the real
// "users can view their own notifications" policy (drizzle/0011), not an
// application-level filter alone.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  if (!ctx.user) return NextResponse.json({ notifications: [], unreadCount: 0 });

  const supabase = await createClient();
  const [{ data: notifs, error: listError }, { count, error: countError }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, message, type, is_read, metadata, created_at")
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.user.id)
      .eq("is_read", false),
  ]);

  if (listError || countError) {
    return NextResponse.json({ error: (listError ?? countError)!.message }, { status: 500 });
  }

  return NextResponse.json({
    notifications: (notifs ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      isRead: n.is_read,
      metadata: n.metadata,
      createdAt: n.created_at,
    })),
    unreadCount: count ?? 0,
  });
});
