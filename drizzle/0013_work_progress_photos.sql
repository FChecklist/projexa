-- Work Progress Report: real photo attachment storage for daily
-- work-progress entries. PROJEXA has never had a file-upload path reachable
-- from the client before this (confirmed absent -- see PROGRESS.md); this
-- is that gap closed for real, using this project's already-provisioned
-- Supabase project (Storage), not a new third-party integration.
--
-- work_progress_photos.veridian_entry_id is a plain text value, not a DB
-- foreign key: the row it points at (compliance.construction_work_progress_
-- entries) lives in VERIDIAN's separate database, reached only over HTTP via
-- callVeridian() (see src/lib/veridian-client.ts) -- a cross-database FK
-- isn't possible here, so integrity for that reference is enforced at the
-- application layer (the photo upload route requires the entry id returned
-- by a real, already-synced POST /api/work-progress response).
--
-- NOT applied live in this session -- no Supabase DB credentials/Management
-- API access were available in this environment (same constraint documented
-- in drizzle/0011_notifications.sql's header). This file is the durable
-- repo record; someone with real Supabase MCP/DB access must apply it
-- (including the storage.buckets insert and storage.objects policies
-- below) before photo upload works end-to-end against a live project.

create table if not exists public.work_progress_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  veridian_entry_id text not null,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists work_progress_photos_entry_idx
  on public.work_progress_photos (organization_id, veridian_entry_id);

alter table public.work_progress_photos enable row level security;

create policy "members can view their org's work progress photos"
  on public.work_progress_photos for select
  using (organization_id in (select organization_id from public.memberships where user_id = auth.uid()));

create policy "members can attach photos for their org"
  on public.work_progress_photos for insert
  with check (
    uploaded_by = auth.uid()
    and organization_id in (select organization_id from public.memberships where user_id = auth.uid())
  );

-- Storage bucket for the actual photo bytes. Private (not public) -- read
-- access is via short-lived signed URLs only (see /api/work-progress/photos
-- GET), matching this repo's general preference for authenticated-only
-- construction data.
insert into storage.buckets (id, name, public)
values ('work-progress-photos', 'work-progress-photos', false)
on conflict (id) do nothing;

-- Objects are stored at `${organizationId}/${veridianEntryId}/${filename}` --
-- policies below key off the leading path segment (storage.foldername(name)[1])
-- matching this org's own membership, same tenant-scoping shape as every
-- other RLS policy in this file, applied to storage.objects instead of a
-- public table.
create policy "members can read their org's work progress photo objects"
  on storage.objects for select
  using (
    bucket_id = 'work-progress-photos'
    and (storage.foldername(name))[1]::uuid in (select organization_id from public.memberships where user_id = auth.uid())
  );

create policy "members can upload work progress photo objects for their org"
  on storage.objects for insert
  with check (
    bucket_id = 'work-progress-photos'
    and (storage.foldername(name))[1]::uuid in (select organization_id from public.memberships where user_id = auth.uid())
  );
