import { NextResponse } from "next/server";
import { createClient } from "./server";
import type { User } from "@supabase/supabase-js";

export type AuthContext = {
  user: User | null;
  organizationId: string | null;
  role: string | null;
  response: NextResponse | null;
};

// Reads via the user's own session JWT (RLS-checked), not a service-role
// key or Drizzle -- PROJEXA doesn't have DATABASE_URL/service-role wired up
// yet, and for user-facing CRUD (todos, chats, assistant history) this is
// the more correct approach anyway: every read here is exactly what RLS
// already allows the signed-in user to see.
export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return { user, organizationId: null, role: null, response: NextResponse.json({ error: "No organization" }, { status: 400 }) };
  }

  return { user, organizationId: membership.organization_id, role: membership.role, response: null };
}
