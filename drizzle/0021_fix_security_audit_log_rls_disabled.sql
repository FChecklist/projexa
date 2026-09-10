-- P2.5 (W-ENV, R81-ADDENDUM-B phase S5): migration-ledger reconciliation.
-- Already applied live via the Supabase MCP on 2026-08-27
-- (supabase_migrations.schema_migrations version 20260827103534,
-- "fix_security_audit_log_rls_disabled_critical"). Backfilled verbatim,
-- idempotent by construction (ENABLE ROW LEVEL SECURITY and REVOKE ALL are
-- no-ops if already applied; CREATE POLICY is guarded).
--
-- CRITICAL fix: public.security_audit_log had RLS fully disabled AND anon +
-- authenticated held full INSERT/SELECT/UPDATE/DELETE/TRUNCATE grants --
-- meaning any unauthenticated caller with the public anon key could read,
-- forge, or wipe the security audit trail via PostgREST. No org_id/tenant
-- column exists (columns: id, event, target_user_id, target_email, actor,
-- metadata, created_at) -- this is a system-level log, not tenant data, and
-- confirmed via GitHub code search (0 references in projexa or
-- compliance-tracker) that no client-side code reads/writes it directly;
-- any legitimate use is server-side via the service role. Locking to
-- service_role only, defense in depth: RLS enabled (blocks at the row
-- level) AND anon/authenticated grants revoked outright (blocks at the
-- privilege level, so a future missing/misconfigured policy still fails
-- closed rather than open).
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.security_audit_log FROM anon, authenticated;

DO $$ BEGIN
  CREATE POLICY service_role_only ON public.security_audit_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
