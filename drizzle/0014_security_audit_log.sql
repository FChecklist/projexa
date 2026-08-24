-- R-A1 / TC-R-A1-20260824: the public demo admin account
-- (demo_manager@projexa-ai.com, org "Demo Organization") had a password
-- rotation Edge Function (rotate-demo-password-r38, deployed straight to
-- the evpckeuxgvahguwsaeul Supabase project with no git-tracked source and
-- no audit logging) but no queryable evidence anywhere that a rotation had
-- ever actually happened -- confirmed via `select count(*) from
-- auth.audit_log_entries` returning 0 rows for this project before this
-- migration. This table gives that requirement a real, app-visible audit
-- trail. Row-level security is intentionally NOT enabled the way tenant
-- tables are: this is a platform/security table with no organization_id to
-- scope by (same non-tenant-RLS shape as public.contact_requests), and it
-- is written only by the Edge Function's own service-role key, never by
-- authenticated app users.
--
-- Applied live via Supabase MCP apply_migration against evpckeuxgvahguwsaeul
-- in the same session that adds this file (see rotate-demo-password-r38's
-- updated source under supabase/functions/ in this same commit).

create table if not exists public.security_audit_log (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  target_user_id uuid,
  target_email text,
  actor text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_audit_log_event_idx
  on public.security_audit_log (event, created_at desc);
