# PROJEXA and the person's own browser AI

Owner order 2026-10-02, requirements R5, R6, R8, R11, R12 (`compliance-tracker/ai-os/PROJEXA_LOCAL_FIRST_REQUIREMENTS.md`):
the AI that lives in the person's browser (Chrome, Edge, Safari; built in or an extension) can work with PROJEXA **for
that signed-in person, on that laptop, on the local database, with their role**, with nothing to set up; and **no AI
can change the software**.

Code: `src/lib/local-first/ai/`. Tests: `bun test --isolate src/lib/local-first/ai`.

## How each kind of browser agent finds PROJEXA

All four doors open by themselves on every signed-in page of the app shell (`src/app/(app)/layout.tsx` mounts
`AiAttach`). Nothing is installed, configured, pasted or approved by the person.

| Agent kind | Door | What it gets |
|---|---|---|
| A browser with **WebMCP** (`navigator.modelContext`, experimental; some browsers / extensions) | the page registers 8 tools: `projexa_manifest`, `projexa_list`, `projexa_get`, `projexa_search`, `projexa_create`, `projexa_update`, `projexa_delete`, `projexa_manual`, each with a JSON schema (`tools.ts`, `webmcp.ts`) | call tools directly; results are MCP text content (JSON); a refusal comes back with `isError: true` and plain words |
| An agent that runs **JavaScript in the page** | `window.projexa.ai` (read-only property; a `projexa:ai-ready` event fires on `window` when it appears) | the same 8 operations as async methods (below) |
| An agent that **reads documents** first | `/llms.txt` (plain words) and `/ai-manual.json` (machine-readable): static files, built once, no personal data, public | what PROJEXA is, every tool and write function with parameters and lowest role, the role table, the rules |
| An agent that **reads the page** | `<script type="application/json" id="px-ai-manual">` in every signed-in page | the same manual as `/ai-manual.json` |
| An agent that **drives the UI** (accessibility tree, clicks by name) | the shell's accessible names and roles | see "Accessible controls" below |

Where WebMCP is absent the registration is skipped silently; the other doors still work.

## `window.projexa.ai`

```js
const ai = window.projexa.ai;
await ai.manifest();                    // person {id, name, role, roleRank}, organisation, projects [{id, name}], kinds,
                                        // functions {create, update, delete} the ROLE may use, settings, integrity
await ai.list("tasks", { projectId, filter: { priority: "high" }, limit: 50 });   // {kind, items, truncated}
await ai.get("rfis", "r1");             // {kind, id, projectId, pending, data} | null
await ai.search("hinge", { projectId });  // {items, truncated}, at most 50
await ai.create("create_rfi", { projectId, subject, question });                   // {status:"queued", opId, tempId?}
await ai.update("update_task", { kind: "tasks", id }, { projectId, issueId: id, title });  // {status:"queued", opId}
await ai.delete("void_material_receipt", { kind: "material_receipts", id }, { projectId, receiptId: id, reason });
                                        // {status:"draft", draftId}  (or "queued" when the person allows it, below)
await ai.manual();                      // the manual for THIS person's role only
await ai.drafts();                      // deletes waiting for the person (read-only copies)
```

Every refusal is a `ProjexaAiError` with a `code` and a `message` in plain words the AI can repeat
(`ROLE_TOO_LOW`, `MISSING_PARAMS`, `PROJECT_NOT_YOURS`, `NOT_READY`, `SOFTWARE_TAMPERED`, ...).

## What the AI can do, and how it is decided

* **Reads** come from the laptop's copy (`local-db.ts`), so they work with no internet and with our server down. The
  copy already holds only what the server lets this person see (organisation, projects, role redaction).
* **Writes** are the AI work link registry's named functions (same ids as the PROJEXA pills; copy in
  `function-registry.json`, refreshed by `scripts/vendor-ai-function-registry.mjs`). Each is checked **on the laptop
  first** against the person's role rank and the function's `min_role_rank`, its required parameters and its declared
  parameters, and refused in plain words when it fails; then it goes through the **outbox** (`outbox.ts`) with the
  optimistic local change, so it shows at once and syncs later. The server checks it again as the person with their
  live role and may still refuse it (CONTRACT.md section 2): the laptop never grants anything.
* **Deletes** are drafts. `delete()` writes nothing; it adds a request the **person** confirms with one click in the
  "Requests from your AI" box (`AiDraftConfirm`). The confirm is deliberately not on `window.projexa.ai` (the AI could
  call it) and only reacts to a trusted user event. The role is checked again at confirm time. If the person has
  "let my AI act without asking" switched on (sent by the sync service's `/manifest` as `settings.ai_act_without_asking`
  or `user.ai_act_without_asking`; default **off**), the delete is queued at once.
* **Who the person is** (role, project names, the setting) is fetched from the sync service's `/manifest` when online
  (at most every 6 hours) and kept in the local database (`ai:identity`), so it works offline. Until it has been fetched
  once, the AI may read but not write.

## The software cannot be changed (R5)

* The surface has no function that writes code, files, the service worker, the release bundle, the cache or the
  configuration, and no eval-like entry point. `immutability.test.ts` enumerates every exposed name (methods, WebMCP
  tools, manual tools, registry functions) against a deny-list and scans the surface's source for `eval`/`new Function`.
* `window.projexa` and `window.projexa.ai` are read-only properties; the API object is frozen.
* Before the first answer, `integrity.ts` re-hashes every installed release file in Cache Storage
  (`px-release-<version>`) against the file table the installer recorded (`app:release`, `app:files` in the device
  database). Any missing / resized / changed file switches the whole surface off (`SOFTWARE_TAMPERED`) and reports it.
  No installed release (a web page or a dev server) is reported as `not_installed` and the surface stays on.

## Accessible controls (for agents that drive the page)

Guarded by `aria-contract.test.ts`:

* Left panel: a tablist "Left panel views" (Modules, Tasks, Frequent Action, Reports, Dashboard, Home), buttons
  "Back one step" and "Reset the chain".
* Actions: group "Things you can do".
* Input: textbox "Describe the task".
* Project: listbox "Switch project" with options.
* Task Master: a tablist of task tabs.
* AI requests: region "Requests from your AI" with "Confirm: ..." and "Keep it: ..." buttons.

## Honest limits

* WebMCP is an experimental draft; two shapes are supported (`registerTool`, `provideContext`). A browser that ships a
  third shape gets the other doors only.
* An agent with full browser control (debugger / CDP) can produce trusted clicks, so it could press "Confirm" itself.
  The confirm protects against scripts in the page, not against an agent that already controls the browser; the server
  remains the authority on what the role may do.
* The registry has no general delete and no generic update today (backend gap R7): `delete()` covers
  `void_material_receipt` only; `update()` covers the registry's named updates. `create_project` is refused offline
  (a project-less op cannot go through the outbox): it is done online.
* `update()` changes locally only fields the row already has with the same name as a parameter; the server's row
  replaces it once applied.
* Drafts live in memory: a reload drops an unconfirmed draft (nothing was written).

## Integration steps still open

1. **Release check.** `origin/feat/lf-pwa-offline` is not merged into this branch. `integrity.ts` mirrors its
   `app:release` / `app:files` meta keys and `px-release-<version>` cache name. After merging, keep the key names in
   step (or import them from `release/release-constants.ts`).
2. **`/local` static shell.** That shell does not exist yet on `origin/feat/lf-pwa-offline`. When it does, mount
   `<AiAttach />` in it the same way as in `src/app/(app)/layout.tsx`.
3. **The setting.** The sync service's `/manifest` must send `settings.ai_act_without_asking` (backend); until it does,
   every AI delete is a draft (the safe default).
