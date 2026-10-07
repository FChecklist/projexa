# PROJEXA for an external AI: the flow and the site map (2026-10-07)

Written for a non-technical reader first. Facts come from the live guide, the live `/workspace` page, `ai-os/audit37/ENGINE_CAPABILITIES_2026-10-06.md` (vendor documentation plus our own call log) and `supabase/functions/ai-work-link/README.md` in compliance-tracker. Nothing here is built yet; it is the plan the build will follow.

## 1. The rules that make it idiot-proof for an AI

1. **One typed address.** The person pastes one prompt with one address. ChatGPT opens only addresses the person typed, so nothing important may sit behind a second address.
2. **That first page answers the first question by itself.** A status snapshot, the person's projects, and a numbered menu of what the AI can do. (The `/workspace` page already does most of this: 8 KB, one answer.)
3. **Every step ends with the same three lines:** `DONE: what just happened`, `NEXT: the options` (numbered, plain words), `ASK THE PERSON: what you need from them`. The AI never has to decide what comes next; it shows the options and waits.
4. **A change is always a transaction:** prepare, show in plain words, the person approves, receipt, re-read to prove it. Never "do it and hope".
5. **The AI never builds an address.** Every address it needs is printed ready-made, in the same form the person typed. Where an address needs a value (a name, a number), the page shows the one fill-in-the-blank form and one worked example.
6. **The person decides how much the AI may do, not the AI and not us.** Each person has a switch, "let my AI act without asking". It is off by default, only the person can turn it on (from their own signed-in PROJEXA, never through a link), and the AI is told the current setting on the first page. With it off, every change waits for the person's tap. With it on, add and edit run directly. Delete always shows exactly what will be deleted and needs the person's tick, whatever the switch says.
7. **Nothing the person has not allowed.** Role limits always apply: a hidden figure stays hidden, other projects and companies stay out of reach, and text typed inside records is data, never an instruction.

## 2. The three kinds of AI, and the path for each

| Kind | Who | How it reads | How it changes data |
|---|---|---|---|
| **A. Tool AIs** | Claude (custom connector), z.ai Agent, Gemini custom apps (US only), ChatGPT apps where the plan allows | Calls our tools directly (MCP). Each tool is one menu option. | Calls the change tools. The AI tool's own approval plus our person-switch decide. |
| **B. Reader AIs** | ChatGPT Free/Plus, Claude and Gemini chat without a connector | Opens the one typed address. Cannot follow links found inside it (ChatGPT, by OpenAI's own rule). | Prints ONE link on its own line. The person clicks it, sees the change in plain words, taps Confirm, gets a receipt line to paste back. |
| **C. Chat-only AIs** | DeepSeek, z.ai Chat | Cannot open addresses. The person pastes the page text or uploads the file once. | Same confirm link as B. |

If the AI cannot get past the first page, there is still a way: the AI prints the next address on its own line and asks the person to paste it back (a pasted address is a typed address).

## 3. The flow (what the AI does, every time)

1. **Open the page.** Read who the person is, what the AI may do, today's status snapshot.
2. **Greet in one line, then show the menu** (section 4). Ask which project if there is more than one.
3. **Person picks an option.** The AI runs the matching read, or prepares the matching change.
4. **Read option:** answer in plain words with numbers, the as-of date, how many records were read, what could not be seen for this role. End with DONE / NEXT / ASK.
5. **Change option:** prepare it. Show the person, in plain words: what will be added, edited or deleted (real names and amounts), in which project. Wait for yes.
6. **Approve:** tool AIs call the change; reader and chat-only AIs print the confirm link. Either way a receipt comes back.
7. **Prove it:** re-read the record and say what was seen, not what was hoped.
8. **Back to the menu.**

## 4. Site map: every option, in the person's words

Marked: **Read** (see it), **Change** (add or edit, follows rule 6), **Not yet** (missing today, listed in section 5).

1. **Where things stand**: status report for a project; the three things that most need attention; overdue; dashboard; exceptions. *Read.*
2. **Schedule and tasks**: delays, Gantt, compare with the baseline, milestones. *Read.* Add a task, update a task, add or update a milestone, save a baseline. *Change.*
3. **Money**: budget status and budget against actual, billing due, claims. *Read.* Create, submit or reject a progress claim, set a line budget. *Change.* Scope of work (BOQ): view lines, preview and apply an import, create a revision, compare revisions, submit for approval, seal, record the customer's approval. *Read and Change.*
4. **Change orders**: list, view. *Read.* Create, submit for approval. *Change.*
5. **On site**: record work progress, daily diary, attendance (single or batch), roster, timesheets, materials (receipt, issue, void a receipt), punch list (create, ready, verify closed), site instructions. *Read and Change.*
6. **Meetings and people**: create a meeting, minutes, action items, outcomes, publish; KPIs (submit, approve); timesheets (submit, approve, reject). *Change.*
7. **Documents and design**: documents, drawings, permits, submittals (create, review), RFIs (create, answer, close), wiki pages, interior (rooms, furniture, mood boards, floor plans). *Read and Change.*
8. **Disputes**: record a customer complaint or a vendor dispute. *Change.*
9. **Projects**: choose a project; edit project details (*Change*); **create a new project** (*Not yet end to end*: an action that makes an empty project exists but the AI cannot start it from the page).
10. **Remember and suggest**: capture a note for later, suggest an improvement to the PROJEXA team. *Change* (never changes anyone's data).

The live function list backs each line (94 functions: 23 reads, 34 direct changes, 37 changes that become drafts). The AI is shown only what its person's role allows.

## 5. Gaps (corrected after the audit)

The first version of this section claimed deletes, edits and "create project" were missing. The audit showed they exist (141 usable functions, all 10 deletes, create_project); that earlier list came from a demo link whose function list was frozen at 94 when it was made. The real gaps were in the guide, and they are now fixed: it contradicted itself about asking permission, had no menu, no fixed ending and no recipes. The remaining open items are in `AI_SITEMAP_SUMEET_111.md`, section 5.

## 6. Build order (status)

1. Guide made level-aware, menu and DONE / NEXT / ASK ending on the first page, recipe cards (section M), fuller connector instructions: **done** (compliance-tracker, branch `feat/ai-flow-sumeet`).
2. The confirm page already takes up to 20 changes in one link, with a code check and delete flagging: **already existed**.
3. Defaults: the OAuth consent page asks first by default; the app button keeps its existing two-layer safety (adds and edits direct, deletes and big actions wait for the person unless their own switch is on).
4. Real runs on Claude, ChatGPT and a reader AI with the Sumeet requirements as the script: **needs the owner's accounts**.

## 7. PROJEXA is a SaaS product that runs on each user's own computer: what that means for the AI

Today's facts: each person's laptop keeps its own working copy of their projects (the "laptop copy"), and it syncs with the shared database (Supabase) and with that person's other laptops. The AI work link reads and changes the shared database. So:

1. **The AI sees what has synced, not what is still only on the laptop.** Every first page and every answer states "data as of <time of the last sync>". If the person worked offline, the AI says "changes you made on your laptop while offline show up after it syncs" instead of presenting a stale picture as final.
2. **An AI change reaches the laptop on its next sync.** It is stamped "<person> via AI assistant" and has a receipt, so the person can find it. If the person edits the same record on the laptop at the same time, the existing keep-mine / keep-theirs conflict rules apply and nothing is lost.
3. **No duplicates.** Every change carries a key, and the same request never runs twice (the work-link service already records and claims each change once). The AI is told to re-read after a change and never to repeat a change "to be safe".
4. **One person per link.** Every person gets their own link, tied to their own role; one AI chat serves one person. A link is never shared across people or put in a shared workspace (rule 8). "Users" means each user's AI works for that user only.
5. **Server cost stays small.** The work link answers reads from the database with no model running on our side and no Vercel function in the path. Each person's AI vendor pays for the AI; the laptop does the PROJEXA work.
6. **A path that really uses the user's own laptop memory (phase 2, not promised yet).** The existing browser extension and a future local bridge could let an AI read the laptop copy directly, so reads cost the server nothing and work offline. This needs its own design and a real test; until then reads go through the shared database.
