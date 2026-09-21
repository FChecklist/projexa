-- PROJEXA-NEXT-001 (2026-09-21): server-side half of "last-used project".
--
-- THE GAP. src/lib/project-preference.ts's pickProject()/pickRouteProject()
-- already remember a person's last-picked project -- but only in a
-- per-browser cookie + localStorage (veri.rail.project), written by
-- M24Shell.tsx's chooseProject(). A brand-new browser, a new device, or
-- cleared site data has no cookie to read, so the very first render falls
-- through to listProjectsForSelection()'s alphabetical-by-name order
-- (source: "auto") -- confirmed live by e2e/site-engineer-project-switcher
-- .spec.ts (PR #308): a fresh login with no stored preference landed on
-- whichever project's name sorts first, not the project this person
-- actually works on. Not a role-specific bug (that spec's whole point), but
-- a real first-visit gap the owner asked to close: "default each person to
-- their last-used project, never alphabetical."
--
-- THE FIX (this migration's half): one nullable column on `memberships`
-- (the real per-user-per-org row), holding the last project id this person
-- resolved to. No FK -- project ids live in VERIDIAN's own `projects`
-- table, not this database (see schema.ts's own header comment) -- so this
-- is intentionally unvalidated at the DB layer. Every READER of this column
-- re-validates it against the caller's live, permission-scoped project
-- list before trusting it (src/lib/project-selection.ts's
-- readPreferredProjectId()), exactly the same "never authority" rule the
-- cookie itself already follows -- a stale id (deleted project, revoked
-- access, another org entirely) is silently ignored, never surfaced as an
-- error.
--
-- Applied directly to the projexa Supabase project (evpckeuxgvahguwsaeul)
-- via the Supabase MCP, same convention as every other migration here
-- (drizzle/0001's own header).
alter table public.memberships
  add column if not exists last_project_id uuid;

comment on column public.memberships.last_project_id is
  'The last VERIDIAN project id this person resolved to in this org, written whenever they explicitly pick a project (M24Shell.tsx chooseProject()) via PATCH /api/user-preference/last-project. No FK (project ids live in VERIDIAN, not this database) -- readers must re-validate against the caller''s live project list, never trust this column alone. Read as a fallback in project-selection.ts''s readPreferredProjectId() only when the veri.rail.project cookie is absent (first visit on a new browser/device).';
