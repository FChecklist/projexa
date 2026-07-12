-- The existing "participants can view co-participants" SELECT policy on
-- public.conversation_participants subqueries conversation_participants
-- itself (to check "am I a participant in this conversation"), which
-- re-triggers the same RLS policy recursively -- Postgres/PostgREST surfaces
-- this as "infinite recursion detected in policy for relation
-- conversation_participants". The INSERT policy has the identical pattern.
--
-- This bug was previously masked: GET /api/conversations 500'd earlier for a
-- different reason (missing profiles FK, see 0006) before the query could
-- even reach RLS evaluation. Fixing 0006 exposed this separate, pre-existing
-- bug -- confirmed live by re-testing GET /api/conversations after 0006
-- applied and still getting a 500, now with error message "infinite
-- recursion detected in policy for relation conversation_participants".
--
-- Standard Supabase fix (documented under "avoid infinite recursion in
-- policies"): a SECURITY DEFINER helper function bypasses RLS for the
-- internal existence check, breaking the recursive cycle. Applied via
-- Supabase MCP; this file is the durable repo record.

create or replace function public.is_conversation_participant(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = p_user_id
  );
$$;

revoke all on function public.is_conversation_participant(uuid, uuid) from public;
grant execute on function public.is_conversation_participant(uuid, uuid) to authenticated;

drop policy if exists "participants can view co-participants" on public.conversation_participants;
create policy "participants can view co-participants"
  on public.conversation_participants for select
  using (public.is_conversation_participant(conversation_id, auth.uid()));

drop policy if exists "participants can add participants to their conversations" on public.conversation_participants;
create policy "participants can add participants to their conversations"
  on public.conversation_participants for insert
  with check (
    user_id = auth.uid()
    or public.is_conversation_participant(conversation_id, auth.uid())
  );
