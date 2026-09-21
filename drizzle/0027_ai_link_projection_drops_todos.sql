-- PROJEXA-E2E-001 / WO-PROJEXA-AI-LINK-001 follow-up (2026-09-21) -- Bug 1 fix,
-- read side. Applied directly to the projexa Supabase project
-- (evpckeuxgvahguwsaeul) via the Supabase MCP, same convention as every
-- other migration here (drizzle/0001's own header).
--
-- THE BUG. ai_link_projection() (drizzle/0023) read public.todos -- a table
-- with NO reachable screen anywhere in PROJEXA's current UI (the only
-- component that ever rendered it, VeriChatPanel.tsx, has been dead code
-- since the R52 M24Shell rewrite). The REAL, currently-live task system is
-- compliance.pipeline_tasks (M24's Task Master, shown in the app's actual
-- "Tasks" tab) -- but that table lives in a DIFFERENT Supabase project
-- (compliance-tracker's own pcrjmlpuqsbocqfwoxod), so this function cannot
-- query it directly: there is no cross-database query available here, and
-- no postgres_fdw set up for it (confirmed: construction/task data is always
-- proxied through VERIDIAN's already-existing, already role-gated
-- /api/v1/projexa/* surface over HTTP, e.g. src/lib/veridian-client.ts's
-- callVeridian(), never a local Postgres query -- see src/app/api/ai/[token]
-- /route.ts's own dashboard-section fetch for the established pattern this
-- migration's companion app-code change now also uses for tasks).
--
-- THE FIX (this migration's half): drop the todos section from the
-- SQL-built projection entirely. The real, live task list is now built in
-- TypeScript (src/app/api/ai/[token]/route.ts), fetched from VERIDIAN's
-- GET /tasks the exact same way the dashboard section already is, and
-- appended to the snapshot as its own "TASKS" section with real ids (Bug 2's
-- fix, same commit). ORGANIZATION and RECENT NOTIFICATIONS stay -- both are
-- genuinely PROJEXA-local concepts (public.organizations, public.
-- notifications), untouched by this change and unrelated to the orphaned-
-- todos bug.
--
-- NOT touched by this migration: public.todos itself, public.
-- email_action_token, or the email-as-interface trigger/columns 0023 also
-- added -- all three remain exactly as-is. They are a genuinely separate,
-- still-live feature (the start/end-of-day digest + reply-by-email system,
-- src/lib/email/*, src/lib/services/{digest-item-service,digest-item-
-- dispatcher,email-token-service}.ts) that this fix does not touch or
-- affect; todos keeps its assignee_id/due_date/note columns for that
-- surface's own use.
create or replace function public.ai_link_projection(p_org uuid, p_user uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_org_name text;
  v_notifications text;
begin
  if not exists (
    select 1 from public.memberships
    where organization_id = p_org and user_id = p_user
  ) then
    raise exception 'not a member of this organization';
  end if;

  select name into v_org_name from public.organizations where id = p_org;

  select string_agg(format('- %s (%s)', title, type), E'\n') into v_notifications
  from (
    select title, type, created_at
    from public.notifications
    where organization_id = p_org
    order by created_at desc
    limit 15
  ) n;

  return format(
    E'ORGANIZATION: %s\n\nRECENT NOTIFICATIONS:\n%s\n',
    coalesce(v_org_name, 'Unknown organization'),
    coalesce(v_notifications, '(none)')
  );
end;
$$;

revoke all on function public.ai_link_projection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_link_projection(uuid, uuid) to service_role;
