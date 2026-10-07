# PROJEXA for an external AI: the site map for Sumeet's 111 requirements (2026-10-07)

Scope: only the requirements in `platform.sumeet_requirements` (112 rows: 81 product rows and 31 exception rows, the "111"). No other module is mapped. Companion to `AI_FLOW_AND_SITEMAP.md` (the flow, the three kinds of AI, the SaaS facts). Source of every function name and input: the live guide's section L (94 functions) and `ai-os/audit37/UPLOAD_CONTRACT_2026-10-06.md`. Nothing here is built yet.

## 1. Sorting the 112 rows: what an AI does, what the software enforces, what is not an AI job

| Group | Rows | What it means for the AI |
|---|---|---|
| **A. Things a person does with their AI** | BOQ and scope (R-01 to 04, R-10 to 24, R-30 to 33, R-70 to 72, R-93, R-96 to 98, R-C13), work progress (R-40 to 48), money views (R-50 to 52, R-60 to 63, R-99, R-100, R-C09, R-C11), billing and milestones (R-94, R-95), site instructions (R-C14), the ten modules (R-C01 to C12), export (R-C15) | These become the menu (section 3). |
| **B. Problem check** | the 28 exception detectors (EXC-ITEM-01 to 28) and their 3 summary rows | One menu item, "Check this project for problems": read-only, the AI runs `get_project_exceptions` and explains each flagged item in plain words. |
| **C. Rules the software enforces** | sub-task maths, "weights need not add to 100", no circular parents, BOQ total excludes sub-tasks, removing or reducing a line that has progress is blocked, progress over 100% refused, missing title refused, AED not rupee | The AI never calculates or decides these. It sends the request and **quotes the software's own sentence** if it is refused (section 4). |
| **D. Not an AI job** | security and legal (R-A1 to A7), the tests and gate (R-B1, R-B2), the screen wiring rows (R-80 to 82, R-90 to 92), the CRR and email platform rows (R-C16, R-C17) | Left out of the AI map. They are owner or engineering items. |

## 2. How the AI moves (the logic that makes it hard to get wrong)

1. **First page.** Who the person is, their switch ("let my AI act without asking"), the data-as-of time, the projects, a status snapshot.
2. **Which project?** Existing: the person picks a number. New: the "New project" card (section 3, area K).
3. **Which area?** The numbered menu in section 3.
4. **Which action?** Every area shows the same short list: *See*, *Add*, *Change*, *Remove*, *Send for approval*, *Attach a file*, *Get a copy*.
5. **Recipe card.** One card per function. The AI asks only the fields on the card, one plain question each, then follows the card.
6. **Show, approve, receipt, re-read** (the flow doc, rule 4). Direct only if the person's switch is on. Removal always shows what goes and needs the person's tick.
7. **End of every answer:** `DONE`, `NEXT` (the menu), `ASK` (what is needed).

## 3. The site map (11 areas) and which of the eight actions each one has

Legend: **Yes** exists today. **Build** missing and in the plan. **Person** the person does this step in PROJEXA, by design (an AI chat cannot send a file or open a PDF or WhatsApp). **Check** not confirmed yet; the first build step audits every function's real inputs before anything is promised.

| # | Area (rows it covers) | See | Add | Change | Remove | Approve / submit | Attach a file | Get a copy |
|---|---|---|---|---|---|---|---|---|
| A | **Scope of work and BOQ** (R-01 to 04, 10 to 24, 30 to 33, 70 to 72, 93, 96, 98, C13) | Yes: lines, compare revisions | Yes: create BOQ, add lines with sub-tasks | **By revision**: a new revision is the edit (blocked by the software if work was done) | Build: delete a draft BOQ (backend has it) | Yes: submit, seal, customer approval | Import file: preview and apply need the file as a document first (Person uploads, AI applies) | Yes: lines as text or CSV |
| B | **Work progress** (R-40 to 48) | Yes: daily report | Yes: record progress by percent or quantity | Yes: correct an entry | Build: delete an entry (backend has it) | n/a | Photos and drawing link: Person uploads, AI links (`set_progress_drawing`) | Yes: daily report as text |
| C | **Money views** (R-50 to 52, 60 to 63, 99, 100, C09, C11) | Yes: dashboard, budget status, variance, analysis, named reports | Check: vendor name and amount per scope item | Yes: line budget; Check: budget % per item | n/a | n/a | n/a | Text or CSV; PDF and WhatsApp: Person |
| D | **Billing and milestones** (R-94, 95) | Yes: billing queue, claims, milestones | Yes: claim, milestone | Yes: update milestone | Check | Yes: submit, reject, draft a claim | n/a | Text |
| E | **Change orders and site instructions** (R-97, C14) | Yes | Yes | Check: edit a draft | Build: cancel a change order (backend has it) | Yes: submit for approval | Site instruction form: Person uploads, AI records | Text |
| F | **Manpower and materials** (R-C07, C08) | Yes: cost reports | Yes: worker, attendance (one or batch), material, receipt, issue | Yes: update worker | Build: delete attendance (backend has it); Yes: void a receipt | n/a | n/a | Text or CSV |
| G | **Schedule and timeline** (R-94, C10) | Yes: Gantt, baseline compare | Yes: task, milestone, baseline | Yes: update task, milestone | Check | n/a | n/a | Text |
| H | **Design studio timesheets** (R-C12) | Yes | Yes: log time | Check | Build: delete a time entry (backend has it) | Yes: submit, approve, reject | n/a | Text |
| I | **Documents and permits, drawings and 3D, minutes of meetings** (R-C01 to 04, C15) | Yes | Yes: permit, drawing, document, meeting, minutes | Yes: document details, minutes; Check: permit, drawing | Build: delete a meeting (backend has it); Check: others | Yes: publish minutes | **Person uploads, AI records the link** (see section 5) | Text; PDF and WhatsApp: Person |
| J | **Problem check** (28 exceptions) | Yes: `get_project_exceptions` | n/a | n/a | n/a | n/a | n/a | Text |
| K | **Projects** | Yes: list | **Build: new project end to end** (an empty-project action exists but the AI cannot start it) | Yes: edit details | n/a | n/a | n/a | n/a |

## 4. The rules that make it idiot-proof, specific to these requirements

1. **The AI never does the maths.** Sub-task amounts, parent percentages, cumulative figures, totals and the "excludes sub-tasks" rule come from the software. The AI quotes figures it read and says where they came from.
2. **A refusal is the answer.** If the software refuses (missing title, parent code that matches nothing, circular parent, child without a percentage, progress over 100%, reducing or removing a line that has work done), the AI shows the software's own sentence in plain words, asks the person what to do, and never retries by changing values to get past the rule.
3. **Never override.** The software offers an explicit override for reducing scope that has work done. The AI never uses it unless the person says, in their own words, that they want to override, after being shown what it affects.
4. **The software needs a fresh key to create a BOQ** (`idempotency_key`). The recipe card gives the AI a fresh one each time, so a retry never creates two.
5. **Money is the organisation's currency** (an org setting, AED for this customer), shown as the software returns it. If a figure is hidden for this role, the AI says so in everyday words and never estimates.
6. **Files: the AI never claims to have uploaded one.** It asks the person to upload in PROJEXA (or paste a link), then records the link.
7. **Copies: the AI offers text or CSV and says PDF and WhatsApp are one tap for the person** in PROJEXA.
8. **Each person's own setting decides how much the AI may do** (the flow doc, rule 6). The AI is told that setting on the first page and never tries to change it.

## 5. Files (upload and download) without pretending

An external AI cannot send file bytes to us. So the honest design is:
- **Upload:** the person uploads in PROJEXA (it already works from their laptop, including offline; the signed-upload route is in the upload contract). The AI then records the permit, drawing or document with that file's link (`create_permit`, `create_drawing`, `create_document`), or asks the person for a shared link to use instead.
- **Import a BOQ file:** the person uploads the file as a document; the AI runs `preview_boq_import` and shows the result, then `apply_boq_import` after the person's yes.
- **Download:** the AI gives text or CSV from the records, and the one-page `/workspace.txt`. PDF and WhatsApp stay the person's one tap.

## 6. Recipe cards (the format, with four examples)

Every card: **Ask** (fields, one plain question each), **Do** (the function), **Check** (re-read and compare), **Say** (one plain sentence), **If refused** (quote the sentence, ask the person). The build generates all cards from the same registry file the work link already uses, so they cannot drift from the real functions.

| Card | Ask | Do | Check | Say | If refused |
|---|---|---|---|---|---|
| Create a BOQ | title, then lines (code, description, unit, qty, rate; for a sub-task: parent code and its % share) | `create_boq` (fresh key), then `add_boq_lines` | re-read the lines; compare the total with the software's | "Created BOQ <title> with <n> lines; total <figure as returned>." | quote it; no retry with altered values |
| Record progress | which item, percent or quantity done, date | `record_work_progress` | re-read the entry; quote previous, current, total | "Recorded <x>% on <item>; total now <y>%." | over 100% or unknown item: quote, ask |
| Revise a BOQ | what changes | `create_boq_revision` | `compare_boq_revisions` | "Revision <n> made; <changes>." | work-done block: quote, never override |
| Add a worker's attendance | worker, date, present or not | `record_attendance` (or the batch) | re-read the day | "Marked <name> present on <date>." | unknown worker: ask |

## 7. Build order (Sumeet 111 only)

1. **Audit** every function the 111 rows touch: its real inputs, whether edit and delete exist, what the `Check` cells hold. Correct the guide's wording (it promises deletes that do not exist).
2. **Defaults and wording:** ask-first by default; the person's switch is the only way to direct changes.
3. **The first page and the ending:** the menu above, the status snapshot, `DONE / NEXT / ASK`.
4. **Recipe cards** generated for all functions in the 11 areas, with the four rules in section 4.
5. **The gaps marked Build**, in this order: the nine existing deletes (each behind the person's tick), new project end to end, BOQ import flow, then edits marked Check.
6. **One confirm page for several changes at once.**
7. **Real runs** on Claude (connector), ChatGPT (typed address) and a reader AI, with the Sumeet requirements as the script. These need the owner's accounts.
