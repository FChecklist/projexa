# PROJEXA

Construction/architecture/interior-design project-management frontend, live
at [PROJEXA-AI.COM](https://projexa-ai.com). Next.js 16 (App Router) +
TypeScript (strict) + Tailwind 4, `bun` as the package manager.

This repo carries **no construction domain data of its own** — schedule,
BOQ, RFIs, punch lists, mood boards, FF&E, floor plans, etc. are all
read/written through a single proxy client, `src/lib/veridian-client.ts`,
which calls VERIDIAN AI OS's `/api/v1/projexa/*` API surface with a Bearer
API key. PROJEXA's own Drizzle schema (`src/lib/db/schema.ts`) holds only
tenant/auth plumbing and PROJEXA's own chat/todo/assistant-history tables.

## Running it

```
bun install
bun run dev
```

See `CLAUDE.md` for the full command list (build, test, lint).

## Where the real architecture picture lives

Read `AGENTS.md` first — it covers what this repo actually is, how it's
been built so far, its Operating Rules, and its relationship to
`FChecklist/compliance-tracker` (the VERIDIAN AI OS backend this repo is a
thin client for).

---
*Added 2026-09-01 as part of a code-quality inspection pass (see
`public.code_quality_inspection_findings` in the `verdian-ai` Supabase
project) that found this repo had no README.md at all.*
