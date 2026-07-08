-- Minimal public profile so org members can see each other's name/email
-- when starting a Chat -- auth.users itself isn't client-queryable.
-- Applied via Supabase MCP; this file is the durable repo record.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "org co-members can view each other's profile"
  on public.profiles for select
  using (
    id in (
      select m2.user_id from public.memberships m1
      join public.memberships m2 on m2.organization_id = m1.organization_id
      where m1.user_id = auth.uid()
    )
    or id = auth.uid()
  );

create policy "users can update their own profile"
  on public.profiles for update
  using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger-only: exposed as a public PostgREST RPC by default, revoke it.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
