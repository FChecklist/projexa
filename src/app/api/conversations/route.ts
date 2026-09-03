import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { withTiming } from "@/lib/with-timing";

export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const supabase = await createClient();
  // RLS already scopes conversations to ones this user participates in.
  const { data, error } = await supabase
    .from("conversations")
    .select("id, created_at, conversation_participants(user_id, profiles(email, display_name)), messages(content, created_at, sender_id)")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    created_at: string;
    conversation_participants: { user_id: string; profiles: { email: string; display_name: string | null } | null }[];
    messages: { content: string; created_at: string; sender_id: string }[];
  };
  const conversations = ((data ?? []) as unknown as Row[]).map((c) => {
    const others = c.conversation_participants.filter((p) => p.user_id !== ctx.user!.id);
    const name = others.map((p) => p.profiles?.display_name || p.profiles?.email || "Unknown").join(", ") || "Just you";
    const lastMessage = [...c.messages].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null;
    return { id: c.id, name, otherParticipantIds: others.map((p) => p.user_id), lastMessage };
  });

  return NextResponse.json({ conversations });
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await request.json();
  const participantUserIds: string[] = Array.isArray(body.participantUserIds) ? body.participantUserIds : [];

  const supabase = await createClient();
  const { data: convo, error: convoError } = await supabase
    .from("conversations")
    .insert({ organization_id: ctx.organizationId! })
    .select()
    .single();
  if (convoError || !convo) return NextResponse.json({ error: convoError?.message ?? "Failed to create conversation" }, { status: 500 });

  const participantRows = Array.from(new Set([ctx.user!.id, ...participantUserIds])).map((userId) => ({
    conversation_id: convo.id,
    user_id: userId,
  }));
  const { error: participantsError } = await supabase.from("conversation_participants").insert(participantRows);
  if (participantsError) return NextResponse.json({ error: participantsError.message }, { status: 500 });

  return NextResponse.json(convo, { status: 201 });
});
