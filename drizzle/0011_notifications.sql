-- Real in-app notifications (Owner-directed gap closure: search/notifications
-- were honestly disclosed as omitted, not faked, in PR #42/#43's
-- veridian-ui-kit migration -- this is that gap actually closed). Shape
-- mirrors compliance-tracker's own notifications table
-- (id/userId/title/message/type/isRead/metadata/createdAt) with
-- organization_id added, since PROJEXA is multi-tenant. RLS follows this
-- repo's own established convention (auth.uid() + memberships subquery, see
-- drizzle/0002_assistant_queries_chat_todo.sql), not compliance-tracker's
-- separate app_runtime/service_role Postgres roles, which don't exist here.
--
-- Real trigger call sites (see src/lib/services/notification-service.ts):
-- RFI created (src/app/api/rfis/route.ts POST), submittal status changed
-- (src/app/api/submittals/[id]/route.ts PATCH), punch list item created
-- (src/app/api/punch-list/route.ts POST) -- each fans out to the acting
-- user's other real org members (public.memberships), so no unused/
-- never-fired table.
--
-- NOT applied live in this session -- no Supabase DB credentials/MCP access
-- were available in this environment (confirmed: no .env.local,
-- SUPABASE_ACCESS_TOKEN present but unauthorized against the Management
-- API). This file is the durable repo record per this repo's own
-- established convention (see drizzle/0002's own header comment); someone
-- with real Supabase MCP/DB access must apply it before the notifications
-- feature works end-to-end against a live database.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'system',
  is_read boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "users can view their own notifications"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "members can create notifications for their org"
  on public.notifications for insert
  with check (organization_id in (select organization_id from public.memberships where user_id = auth.uid()));

create policy "users can update their own notifications"
  on public.notifications for update
  using (user_id = auth.uid());
