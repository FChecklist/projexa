-- Self-serve signup needs INSERT policies that weren't in the original
-- schema migration (which only covered read access for already-provisioned
-- members). Applied via Supabase MCP; this file is the durable repo record.

create policy "authenticated users can create an organization"
  on public.organizations for insert
  with check (auth.uid() is not null);

create policy "users can claim owner on a brand new org, or admins can add members"
  on public.memberships for insert
  with check (
    user_id = auth.uid()
    and (
      not exists (
        select 1 from public.memberships m2
        where m2.organization_id = memberships.organization_id
      )
      or organization_id in (
        select organization_id from public.memberships
        where user_id = auth.uid() and role in ('owner', 'admin')
      )
    )
  );
