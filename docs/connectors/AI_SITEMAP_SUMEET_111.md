# PROJEXA for an external AI: the site map for Sumeet's 111 requirements (corrected after the audit, 2026-10-07)

Scope: only the requirements in `platform.sumeet_requirements` (112 rows: 81 product rows and 31 exception rows, the "111"). No other module is mapped. Companion to `AI_FLOW_AND_SITEMAP.md` (the flow, the three kinds of AI, the SaaS facts).

**Audit result, in one paragraph.** An earlier version of this file listed many "Build" gaps (deletes, edits, create project). The audit of the live registry (`function-registry.generated.json`, 159 entries, 141 usable by a link) and of a freshly made link showed those functions already exist: all 10 deletes, 19 edits, `create_project`, `update_boq_line`, `update_line_item_budget` with budget percentage and vendor fields. The earlier list came from a demo link whose stored function list was frozen at 94 when it was made. What was really wrong was the guide: it contradicted itself about asking permission, had no menu, no fixed ending and no recipes. That is now fixed (compliance-tracker, `manual.ts` section M and the first page).

## 1. Sorting the 112 rows

| Group | Rows | What it means for the AI |
|---|---|---|
| **A. Things a person does with their AI** | BOQ and scope (R-01 to 04, R-10 to 24, R-30 to 33, R-70 to 72, R-93, R-96 to 98, R-C13), work progress (R-40 to 48), money views (R-50 to 52, R-60 to 63, R-99, R-100, R-C09, R-C11), billing and milestones (R-94, R-95), site instructions (R-C14), the ten modules (R-C01 to C12), export (R-C15) | The menu (section 3). |
| **B. Problem check** | the 28 exception detectors and their 3 summary rows | One menu item: `get_project_exceptions`, each flagged item explained in plain words. |
| **C. Rules the software enforces** | sub-task maths, weights not forced to 100, no circular parents, BOQ total excludes sub-tasks, removing or reducing a line that has work done is blocked, progress over 100% refused, missing title refused, AED not rupee | The AI never calculates. It quotes the software's own refusal sentence (guide section M). |
| **D. Not an AI job** | security and legal (R-A1 to A7), tests and gate (R-B1, R-B2), screen wiring (R-80 to 82, R-90 to 92), CRR and email platform rows (R-C16, R-C17) | Left out. |

## 2. How the AI moves (now in the guide's first page)

1. Who the person is, their switch, the data-as-of time, the projects, a status snapshot.
2. Which project? (the numbered list; "Create New Project" is a line in it)
3. The numbered menu of 11 areas (below).
4. The recipe for the chosen area (section M of the guide): ask only what the function needs, check, show in plain words, do it as the link allows, read it back.
5. Every answer ends with `DONE`, `NEXT`, `ASK`.

## 3. The 11 areas and the functions behind each

`C` runs directly on a link that allows direct changes. `D` is a draft the person confirms, unless the person has turned on their own "let my AI act without asking" switch. Deletes are all `D`.

| # | Area | See | Add | Change | Remove | Approve or submit | Files |
|---|---|---|---|---|---|---|---|
| 1 | Where things stand | `get_project_analysis`, `get_project_exceptions`, dashboard | n/a | n/a | n/a | n/a | n/a |
| 2 | Scope of work and BOQ | `get_boq_line_items`, `compare_boq_revisions`, `preview_boq_import` | `create_boq`, `add_boq_lines` (D) | `update_boq`, `update_boq_line` (C); `update_boq_line_amounts`, `create_boq_revision` (D) | `delete_boq` (D) | `submit_boq_for_approval`, `seal_boq`, `record_customer_approval` (D) | Import: the person uploads, then `apply_boq_import` (D) |
| 3 | Work progress | `get_daily_progress_report` | `record_work_progress` (C) | `update_progress_entry` (C) | `delete_progress_entry` (D) | n/a | Photos: the person uploads; `set_progress_drawing` (D) |
| 4 | Budget, money, profit | budget status, variance, analysis, named reports | n/a | `update_line_item_budget` (D): budget percentage, vendor, vendor amount, manpower and material amounts (R-C09) | n/a | n/a | PDF and WhatsApp: the person |
| 5 | Billing and milestones | billing queue, claims, milestones | `create_progress_claim` (D), `create_milestone` (C) | `update_milestone` (C) | none (gap, rarely needed) | `draft_`, `submit_`, `reject_progress_claim` (D) | n/a |
| 6 | Change orders and site instructions | list, view | `create_change_order`, `create_site_instruction` (D) | `update_change_order` (D); site instruction: none (gap) | `cancel_change_order` (D); site instruction: none (gap) | `submit_change_order_for_approval` (D) | Site instruction form: the person uploads |
| 7 | Manpower and materials | cost reports | `add_roster_entry`, `record_attendance`, `record_attendance_batch`, `create_material`, `record_material_receipt`, `record_material_issue` | `update_roster_entry`, `update_attendance`, `update_material` (D) | `delete_attendance`, `void_material_receipt` (D); worker: switch off with `update_roster_entry` | n/a | n/a |
| 8 | Schedule and timeline | Gantt, schedule, baseline compare | `create_schedule_task` (C), `capture_schedule_baseline` (D) | `update_task` (C) | `archive_task` (D) | n/a | n/a |
| 9 | Design studio timesheets | designer timesheet report | `record_timesheet` (C) | `update_time_entry` | `delete_time_entry` (D) | `submit_`, `approve_`, `reject_timesheet` (D) | n/a |
| 10 | Documents, permits, drawings, meetings | list records | `create_document`, `create_permit` (C), `create_drawing` (D), `create_meeting`, `create_mom` (C) | `update_document_metadata`, `update_permit`, `update_meeting`, `update_mom_minutes` (C); drawing: none (gap) | `dispose_document`, `delete_permit`, `delete_meeting`, `delete_mom` (D); drawing: none (gap) | `publish_mom` (D) | The person uploads; the AI records the link. PDF and WhatsApp: the person |
| 11 | Projects | project list | `create_project` (D, the Start here line) | `update_project` (D) | `archive_project` (D) | n/a | n/a |

## 4. What the guide now tells the AI (specific to these requirements)

1. Never do the maths; quote the software's figures and say where they came from.
2. A refusal is the answer: show the software's own sentence in plain words, ask the person what to do, never retry with altered values.
3. Never override a block (reducing scope that has work done) unless the person says so in their own words, after seeing what it affects.
4. `create_boq` needs a fresh `idempotency_key` each time; never reuse one.
5. Money is in the organisation's currency; a hidden value stays hidden.
6. The AI cannot upload a file; the person uploads in PROJEXA (or gives a shared link), then the AI records the link. PDF and WhatsApp are the person's own tap; the AI offers text or CSV.
7. Removing something: the matching delete or cancel function, show exactly what will go; the person's own switch decides whether it waits for their tap.
8. If a function a recipe names is missing from a link's own list, say so in everyday words.

## 5. What is still open, honestly

| Item | Why | Next step |
|---|---|---|
| Drawings: no edit or delete; site instructions: no edit or delete; milestone, worker and material-issue delete | The registry has no such function | Add them only if a real run shows they are needed (each needs a backend service function and tests). |
| Links made earlier carry a frozen function list | A link stores its function list when made (the demo link had 94); functions added later never reach it | New links get the full list. Links last 7 to 30 days, so this fades; re-make an old link to pick up new functions. |
| An AI cannot send a file | An AI chat has no way to POST bytes to us | By design a person step, with the AI recording the link afterwards (guide section M). |
| Real runs in Claude (connector), ChatGPT (typed address) and a reader AI | They need the owner's accounts | Run the Sumeet requirements as the script and record the results. |
| The app button's default level | The one-click button makes project links at level 1 and a person-wide link at the highest level the role allows. Adds and edits run directly; deletes and the big actions (`D`) still wait for the person unless their own switch is on. The OAuth consent page defaults to ask-first. | Left as it is, because deletes are already protected by default; say if you want every change to wait. |
