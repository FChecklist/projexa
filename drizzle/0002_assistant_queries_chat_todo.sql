-- Generic app data for PROJEXA's VeriComposer-style Mode Pills / Chain
-- Selector / Chatbox port. None of this is construction domain data (that
-- stays in VERIDIAN) -- it's PROJEXA's own users' collaboration state.
-- Applied directly via Supabase MCP; this file is the durable repo record.

create table if not exists public.assistant_queries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  code_reference text not null,
  breadcrumb text not null,
  inputs jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.assistant_queries enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.todos enable row level security;

create policy "members can view their org's assistant queries"
  on public.assistant_queries for select
  using (organization_id in (select organization_id from public.memberships where user_id = auth.uid()));

create policy "members can create assistant queries for their org"
  on public.assistant_queries for insert
  with check (
    created_by = auth.uid()
    and organization_id in (select organization_id from public.memberships where user_id = auth.uid())
  );

create policy "members can update their own assistant queries"
  on public.assistant_queries for update
  using (created_by = auth.uid());

create policy "participants can view their conversations"
  on public.conversations for select
  using (id in (select conversation_id from public.conversation_participants where user_id = auth.uid()));

create policy "members can create conversations for their org"
  on public.conversations for insert
  with check (organization_id in (select organization_id from public.memberships where user_id = auth.uid()));

create policy "participants can view co-participants"
  on public.conversation_participants for select
  using (
    conversation_id in (select conversation_id from public.conversation_participants where user_id = auth.uid())
  );

create policy "participants can add participants to their conversations"
  on public.conversation_participants for insert
  with check (
    user_id = auth.uid()
    or conversation_id in (select conversation_id from public.conversation_participants where user_id = auth.uid())
  );

create policy "participants can view messages in their conversations"
  on public.messages for select
  using (conversation_id in (select conversation_id from public.conversation_participants where user_id = auth.uid()));

create policy "participants can send messages in their conversations"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and conversation_id in (select conversation_id from public.conversation_participants where user_id = auth.uid())
  );

create policy "users can view their own todos"
  on public.todos for select
  using (user_id = auth.uid());

create policy "users can create their own todos"
  on public.todos for insert
  with check (
    user_id = auth.uid()
    and organization_id in (select organization_id from public.memberships where user_id = auth.uid())
  );

create policy "users can update their own todos"
  on public.todos for update
  using (user_id = auth.uid());

create policy "users can delete their own todos"
  on public.todos for delete
  using (user_id = auth.uid());
