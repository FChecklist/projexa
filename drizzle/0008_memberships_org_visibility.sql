-- Priority 16 Part 2: Settings > Team member list is structurally broken for
-- every PROJEXA org. Root cause (fully proven in
-- control/priority16_e2e_testing_plan.md, "Settings" gap entry, via a direct
-- pg_policies query against this project): the only SELECT policy on
-- public.memberships is "users can view their own memberships"
-- (qual: user_id = auth.uid()). GET /api/org-members deliberately filters out
-- the caller's own row (`.filter((m) => m.user_id !== ctx.user!.id)`) to show
-- "other teammates" -- so "rows I can see" minus "my own row" is always the
-- empty set, for every org, unconditionally. This also breaks the VERI Chat
-- "start a conversation with a teammate" picker (VeriChatPanel.tsx), which
-- fetches the same endpoint.
--
-- Fix: add a second, additive SELECT policy allowing a member to see every
-- membership row that shares an organization_id with one of their own
-- memberships -- the standard "see my teammates" pattern. Postgres RLS
-- policies of the same command type are OR'd together (permissive by
-- default), so this coexists with the existing own-row policy rather than
-- replacing it.
--
-- Recursion hazard, learned from this exact repo's own history (see
-- 0007_fix_conversation_participants_rls_recursion.sql): a SELECT policy on
-- public.memberships cannot directly subquery public.memberships in its
-- USING clause -- that self-reference re-triggers the same policy being
-- evaluated and Postgres raises "infinite recursion detected in policy for
-- relation memberships". 0007 established the fix for the identical shape on
-- conversation_participants: a SECURITY DEFINER helper function bypasses RLS
-- for the internal lookup, breaking the recursive cycle. Applying the same
-- convention here.
--
-- Scope check: the helper only returns organization_id values drawn from the
-- caller's own memberships (auth.uid()), so the new policy can only ever
-- widen visibility to rows within an org the caller already belongs to --
-- it does not expose membership rows from a different organization.
--
-- Applied live via Supabase MCP against project ref evpckeuxgvahguwsaeul;
-- this file is the durable repo record of that DDL.

create or replace function public.user_organization_ids(p_user_id uuid)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id from public.memberships where user_id = p_user_id;
$$;

revoke all on function public.user_organization_ids(uuid) from public;
grant execute on function public.user_organization_ids(uuid) to authenticated;

create policy "members can view teammates in their organization"
  on public.memberships for select
  using (organization_id in (select public.user_organization_ids(auth.uid())));
