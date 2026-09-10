-- P2.5 (W-ENV, R81-ADDENDUM-B phase S5): migration-ledger reconciliation.
-- Already applied live via the Supabase MCP on 2026-08-27
-- (supabase_migrations.schema_migrations version 20260827120249,
-- "optimize_rls_initplan_and_merge_permissive_policies"). Backfilled with
-- one deliberate change from what was actually run: the final DROP POLICY
-- / CREATE POLICY pair is wrapped for idempotency (IF EXISTS / a
-- duplicate_object guard) so this file is a true no-op on replay against
-- the live DB, which already has it applied -- the live run didn't need
-- that wrapping because it only ran once, but a migration file that will
-- sit in this directory forever does. Every ALTER POLICY statement is
-- unchanged and already idempotent (re-altering a policy to an identical
-- definition is not an error).
--
-- Perf advisor: auth_rls_initplan (24 findings) -- wrap auth.<fn>() calls in
-- RLS USING/WITH CHECK clauses with (select auth.<fn>()) so Postgres evaluates
-- them once per query instead of once per row. Logic is unchanged: literal
-- text substitution of auth.uid() -> (select auth.uid()) inside each policy's
-- existing expression, pulled verbatim from pg_policies before applying.

ALTER POLICY "members can create assistant queries for their org" ON public.assistant_queries
  WITH CHECK ((created_by = (select auth.uid())) AND (organization_id IN (SELECT memberships.organization_id FROM memberships WHERE memberships.user_id = (select auth.uid()))));

ALTER POLICY "members can update their own assistant queries" ON public.assistant_queries
  USING (created_by = (select auth.uid()));

ALTER POLICY "members can view their org's assistant queries" ON public.assistant_queries
  USING (organization_id IN (SELECT memberships.organization_id FROM memberships WHERE memberships.user_id = (select auth.uid())));

ALTER POLICY "members can create conversations for their org" ON public.conversations
  WITH CHECK (organization_id IN (SELECT memberships.organization_id FROM memberships WHERE memberships.user_id = (select auth.uid())));

ALTER POLICY "participants can view their conversations" ON public.conversations
  USING (id IN (SELECT conversation_participants.conversation_id FROM conversation_participants WHERE conversation_participants.user_id = (select auth.uid())));

ALTER POLICY "participants can add participants to their conversations" ON public.conversation_participants
  WITH CHECK ((user_id = (select auth.uid())) OR is_conversation_participant(conversation_id, (select auth.uid())));

ALTER POLICY "participants can view co-participants" ON public.conversation_participants
  USING (is_conversation_participant(conversation_id, (select auth.uid())));

ALTER POLICY "participants can send messages in their conversations" ON public.messages
  WITH CHECK ((sender_id = (select auth.uid())) AND (conversation_id IN (SELECT conversation_participants.conversation_id FROM conversation_participants WHERE conversation_participants.user_id = (select auth.uid()))));

ALTER POLICY "participants can view messages in their conversations" ON public.messages
  USING (conversation_id IN (SELECT conversation_participants.conversation_id FROM conversation_participants WHERE conversation_participants.user_id = (select auth.uid())));

ALTER POLICY "members can create notifications for their org" ON public.notifications
  WITH CHECK (organization_id IN (SELECT memberships.organization_id FROM memberships WHERE memberships.user_id = (select auth.uid())));

ALTER POLICY "users can update their own notifications" ON public.notifications
  USING (user_id = (select auth.uid()));

ALTER POLICY "users can view their own notifications" ON public.notifications
  USING (user_id = (select auth.uid()));

ALTER POLICY "org admins can create invites in their organization" ON public.org_invites
  WITH CHECK (EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = org_invites.organization_id AND m.user_id = (select auth.uid()) AND m.role = ANY (ARRAY['owner'::text,'admin'::text])));

ALTER POLICY "org admins can revoke their organization's invites" ON public.org_invites
  USING (EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = org_invites.organization_id AND m.user_id = (select auth.uid()) AND m.role = ANY (ARRAY['owner'::text,'admin'::text])));

ALTER POLICY "org admins can view their organization's invites" ON public.org_invites
  USING (EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = org_invites.organization_id AND m.user_id = (select auth.uid()) AND m.role = ANY (ARRAY['owner'::text,'admin'::text])));

ALTER POLICY "authenticated users can create an organization" ON public.organizations
  WITH CHECK ((select auth.uid()) IS NOT NULL);

ALTER POLICY "members can view their organization, or a brand new memberless " ON public.organizations
  USING ((id IN (SELECT memberships.organization_id FROM memberships WHERE memberships.user_id = (select auth.uid()))) OR (NOT EXISTS (SELECT 1 FROM memberships WHERE memberships.organization_id = organizations.id)));

ALTER POLICY "org co-members can view each other's profile" ON public.profiles
  USING ((id IN (SELECT m2.user_id FROM memberships m1 JOIN memberships m2 ON m2.organization_id = m1.organization_id WHERE m1.user_id = (select auth.uid()))) OR (id = (select auth.uid())));

ALTER POLICY "users can update their own profile" ON public.profiles
  USING (id = (select auth.uid()));

ALTER POLICY "users can create their own todos" ON public.todos
  WITH CHECK ((user_id = (select auth.uid())) AND (organization_id IN (SELECT memberships.organization_id FROM memberships WHERE memberships.user_id = (select auth.uid()))));

ALTER POLICY "users can delete their own todos" ON public.todos
  USING (user_id = (select auth.uid()));

ALTER POLICY "users can update their own todos" ON public.todos
  USING (user_id = (select auth.uid()));

ALTER POLICY "users can view their own todos" ON public.todos
  USING (user_id = (select auth.uid()));

ALTER POLICY "members can attach photos for their org" ON public.work_progress_photos
  WITH CHECK ((uploaded_by = (select auth.uid())) AND (organization_id IN (SELECT memberships.organization_id FROM memberships WHERE memberships.user_id = (select auth.uid()))));

ALTER POLICY "members can view their org's work progress photos" ON public.work_progress_photos
  USING (organization_id IN (SELECT memberships.organization_id FROM memberships WHERE memberships.user_id = (select auth.uid())));

ALTER POLICY "users can claim owner on a brand new org, or admins can add mem" ON public.memberships
  WITH CHECK ((user_id = (select auth.uid())) AND ((NOT organization_has_any_member(organization_id)) OR (organization_id IN (SELECT user_admin_organization_ids((select auth.uid()))))));

-- Perf advisor: multiple_permissive_policies -- memberships had two separate
-- permissive SELECT policies (evaluated as an OR at runtime anyway). Replace
-- both with a single policy whose USING clause is the literal OR of the two
-- original conditions -- mathematically identical access, one policy to
-- evaluate instead of two.
DROP POLICY IF EXISTS "members can view teammates in their organization" ON public.memberships;
DROP POLICY IF EXISTS "users can view their own memberships" ON public.memberships;
DO $$ BEGIN
  CREATE POLICY "members can view teammates in their organization" ON public.memberships
    FOR SELECT
    USING ((organization_id IN (SELECT user_organization_ids((select auth.uid())))) OR (user_id = (select auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
