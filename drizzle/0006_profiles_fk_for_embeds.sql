-- PostgREST embedded-relationship selects (e.g. `profiles(email, display_name)`
-- nested under memberships/conversation_participants) require a declared FK
-- to resolve the join. Both tables already have user_id -> auth.users.id, but
-- that doesn't let PostgREST infer a join to public.profiles. Add explicit
-- FKs to profiles(id) so /api/org-members and /api/conversations can embed.
--
-- Fixes: GET /api/org-members and GET /api/conversations both returning 500
-- on every request ("Could not find a relationship between memberships and
-- profiles" / same for conversation_participants), since they're called from
-- the shared layout on every navigation.
--
-- Verified beforehand: no orphaned user_id values in either table (2/2
-- memberships rows matched an existing profiles row; conversation_participants
-- had 0 rows). Applied via Supabase MCP; this file is the durable repo record.

alter table public.memberships
  add constraint memberships_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.conversation_participants
  add constraint conversation_participants_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
