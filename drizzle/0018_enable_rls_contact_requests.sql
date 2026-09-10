-- P2.5 (W-ENV, R81-ADDENDUM-B phase S5): migration-ledger reconciliation.
-- This DDL was already applied live via the Supabase MCP on 2026-07-19
-- (supabase_migrations.schema_migrations version 20260719064149,
-- "enable_rls_contact_requests") but was never added to this drizzle
-- directory, so `drizzle-kit` and CI have never seen it. Backfilled
-- verbatim here, idempotent by construction (ENABLE ROW LEVEL SECURITY is
-- a no-op if already enabled; both CREATE POLICY calls are guarded), so
-- replaying it against the live DB -- which already has this applied --
-- is a true no-op, and it also brings a fresh DB up to the same state.
--
-- Closes an RLS-disabled finding on public.contact_requests (marketing-site
-- "Talk to an Engineer" lead capture, no organization_id -- anonymous
-- visitors are meant to INSERT their own submission, but with RLS disabled
-- anyone with the anon key could also SELECT/UPDATE/DELETE every other
-- visitor's submission, not just insert their own). Insert-only for
-- anon/authenticated; service_role (the only real reader, via an admin
-- notification/export path) keeps full bypass.
ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY anon_insert_contact_requests ON public.contact_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_contact_requests ON public.contact_requests FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
