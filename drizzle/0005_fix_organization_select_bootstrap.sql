-- Bug found via real browser signup test: organizations' original SELECT
-- policy only allowed seeing orgs you already have a membership in. But
-- Supabase's insert().select() re-reads the row via that same SELECT
-- policy immediately after INSERT -- before the membership row exists --
-- so a brand-new org's insert+select round trip failed with 403. Fix:
-- also allow seeing a still-memberless org (mirrors the same bootstrap
-- exception already used in memberships' own insert policy). Applied via
-- Supabase MCP; this file is the durable repo record.
drop policy "members can view their organization" on public.organizations;

create policy "members can view their organization, or a brand new memberless one"
  on public.organizations for select
  using (
    id in (select organization_id from public.memberships where user_id = auth.uid())
    or not exists (select 1 from public.memberships where organization_id = organizations.id)
  );
