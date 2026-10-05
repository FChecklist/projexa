import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN } from "./support/boq-local";
import { P1, PEOPLE, signIn, stubAppApis, stubSync, type Net, type Person } from "./support/lf-ai-stub";
import { BACKEND_OWN_AI_SENTENCE } from "../src/lib/local-first/ai-off/internal-ai";

// Audit 100 row A4 ("the internal AI chatbox does the work for the user"), the UI half, in a REAL Chromium against the production build.
//
// WHERE THE CHAT BOX IS: the online app. The laptop shell (local-first, the default for a signed-in browser) has no chat box -- it draws
// its own screens and offers the person's OWN AI through the AI link instead -- so this spec opens the app the way a person who turned
// local-first off sees it (px-local-first-off, the same opt-out setLocalFirstEnabled(false) writes), where M24Shell is on screen.
//
// The chat box is the one docked composer every app route shows (shell/Composer.tsx: <textarea aria-label="Describe the task"> and
// data-testid="composer-send"; VeriComposer.tsx is not mounted anywhere). M24Shell.onSubmit sends the typed words as POST /api/tasks
// (PROJEXA's proxy of VERIDIAN's /api/v1/projexa/tasks) and gets a VERDICT back; nothing is written until the person presses Confirm
// on the ConfirmCard, which sends ONE second POST {confirm:true, submissionId}.
//
// The backend half (the typed words reach Claude Code on the laptop through the AI bridge, the verdict, the confirm, the persisted
// schedule task, the read-only refusal, the AI-off sentence) is proven LIVE by compliance-tracker
// scripts/verify/awl-live/internal-ai-chat.live.test.ts (#2076). Here /api/tasks is answered in the browser with the SAME verdict shapes
// that backend returns (compliance-tracker src/lib/pipeline/verdict.ts), so what the page does with them is real.
//
// AI OFF, stated plainly rather than implied: the composer has no client-side internal-AI switch. With PROJEXA's own AI off (the shipped
// default; the sync manifest carries no internal_ai field) it still sends the typed words to /api/tasks, because Level 0 (the phrase
// map) is software, not a model, and still answers what it knows. A sentence only a model could understand comes back from the backend
// as its own-AI gap (dry-run.ts gapAnswer, USE_YOUR_OWN_AI), and the page must show that plain sentence, offer nothing to confirm, send
// no confirm, and send nothing to the model routes (/api/discuss, /api/assistant).

const TYPED = "jot a job onto the programme: pour the roof slab starting 20 October";
const SUBMISSION_ID = "lf-chat-sub-0001";
const CHAIN = `${P1.name} › Schedule › New schedule task`;

/** What VERIDIAN answers to the typed words when it understood a write: a confirmable verdict (verdict.ts toVerdictResult). */
const UNDERSTOOD = {
  verdict: "task",
  status: "ready",
  understood: { functionId: "create_schedule_task", label: "New schedule task", params: { title: "Pour the roof slab", startDate: "2026-10-20" } },
  missing: [],
  chain: CHAIN,
  confirmable: true,
  submissionId: SUBMISSION_ID,
  verdicts: [],
};

/** What VERIDIAN answers when its own AI is off and only a model could have understood the words (gapAnswer with useYourOwnAi). */
const OWN_AI_GAP = {
  verdict: "gap",
  status: "gap",
  understood: null,
  missing: [],
  chain: null,
  confirmable: false,
  message: `${BACKEND_OWN_AI_SENTENCE} - Open Home`,
  links: [{ label: "Open Home", route: "/dashboard" }],
  verdicts: [],
};

/** Signs the manager in (local Auth stand-in), answers the sync service and every /api call of the shell, with local-first turned OFF. */
async function openOnlineApp(page: Page, context: BrowserContext): Promise<{ apiRequests: string[] }> {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("px-local-first-off", "1");
      localStorage.removeItem("px-local-first");
    } catch {
      /* storage blocked: the default would turn local-first on and the box would not be there, which the test reports */
    }
  });
  const people = new Map<string, Person>();
  const net: Net = { mode: "up" };
  const person = PEOPLE.manager;
  const session = await signIn(context, people, person);
  await stubSync(context, people, net);
  const apiRequests = await stubAppApis(context, APP_ORIGIN, () => ({ person, session }), net);
  return { apiRequests };
}

type TasksSeen = { posts: Record<string, unknown>[]; listReads: number };

/** Answers the page's /api/tasks (page routes run before the laptop's catch-all context route). */
async function stubTasks(page: Page, verdict: unknown): Promise<TasksSeen> {
  const seen: TasksSeen = { posts: [], listReads: 0 };
  let confirmed = false;
  await page.route("**/api/tasks*", async (route, request) => {
    const url = new URL(request.url());
    if (url.origin !== APP_ORIGIN || url.pathname !== "/api/tasks") return route.fallback();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      seen.posts.push(body);
      if (body.confirm === true) {
        confirmed = true;
        return json(201, { submissionId: SUBMISSION_ID, tasks: [{ taskId: "lf-chat-task-1", functionId: "create_schedule_task", status: "done", segmentText: TYPED }] });
      }
      return json(200, verdict);
    }
    seen.listReads += 1;
    const tasks = confirmed ? [{ id: "lf-chat-task-1", projectId: P1.id, functionId: "create_schedule_task", status: "done", rawInput: TYPED, mode: "Projects" }] : [];
    return json(200, { tasks, counts: { needsYou: 0, running: 0, done: tasks.length, blocked: 0, total: tasks.length }, nextCursor: null });
  });
  return seen;
}

async function typeAndSend(page: Page, words: string) {
  const box = page.getByRole("textbox", { name: "Describe the task" });
  await expect(box, "the docked chat box is not on the page").toBeVisible({ timeout: 60_000 });
  await box.fill(words);
  await page.getByTestId("composer-send").click();
}

const modelRoutes = (requests: string[]) => requests.filter((r) => /\s\/api\/(discuss|assistant)\b/.test(r) && r.startsWith("POST"));

test.describe("Audit 100 A4 -- the in-app chat box does the work for the person (real browser)", () => {
  test("typed command: the right request, the understanding and the Confirm step in plain words, one confirmed write", async ({ page, context }) => {
    const laptop = await openOnlineApp(page, context);
    const seen = await stubTasks(page, UNDERSTOOD);
    await page.goto(`/schedule?projectId=${P1.id}`);

    await test.step("the page sends the typed words, with the open project, as one POST /api/tasks", async () => {
      await typeAndSend(page, TYPED);
      await expect.poll(() => seen.posts.length, { message: "the chat box never sent the typed words" }).toBe(1);
      const sent = seen.posts[0];
      expect(sent.rawInput).toBe(TYPED);
      expect(sent.projectId).toBe(P1.id);
      expect(typeof sent.mode).toBe("string");
      // A typed command is never a write on Send: no confirm flag, no function id chosen by the page.
      expect(sent.confirm).toBeUndefined();
      expect(sent.functionId).toBeUndefined();
    });

    const card = page.getByRole("region", { name: `Understood: ${CHAIN}` }).or(page.getByLabel(`Understood: ${CHAIN}`));
    await test.step("what was understood and the Confirm step are shown in plain words, and nothing is written yet", async () => {
      await expect(card.first(), "the confirm card never appeared").toBeVisible();
      await expect(card.first()).toContainText(`Understood: ${CHAIN}`);
      await expect(card.first().getByRole("button", { name: "Confirm" })).toBeVisible();
      await expect(card.first().getByRole("button", { name: "Edit" })).toBeVisible();
      // Plain words: never a function id or a parameter name.
      const text = (await card.first().innerText()).toLowerCase();
      for (const technical of ["create_schedule_task", "startdate", "submissionid", "functionid"]) expect(text).not.toContain(technical);
      expect(seen.posts.filter((p) => p.confirm === true)).toHaveLength(0);
    });

    await test.step("Confirm posts the confirmation exactly once and the new task is read back", async () => {
      const readsBefore = seen.listReads;
      await card.first().getByRole("button", { name: "Confirm" }).click();
      await expect.poll(() => seen.posts.filter((p) => p.confirm === true).length, { message: "Confirm never reached /api/tasks" }).toBe(1);
      expect(seen.posts.find((p) => p.confirm === true)).toEqual({ confirm: true, submissionId: SUBMISSION_ID, functionId: "create_schedule_task", params: {} });
      await expect(card.first(), "the confirm card stayed open after a successful confirm").toHaveCount(0);
      await expect.poll(() => seen.listReads, { message: "the task list was never re-read after the confirm" }).toBeGreaterThan(readsBefore);
      await page.waitForTimeout(1_500);
      expect(seen.posts.filter((p) => p.confirm === true), "the confirmation was sent more than once").toHaveLength(1);
      expect(seen.posts).toHaveLength(2);
    });

    expect(modelRoutes(laptop.apiRequests), "the chat box reached a model route").toEqual([]);
  });

  test("PROJEXA's own AI off: the plain own-AI sentence, nothing to confirm, no confirm and nothing sent to a model route", async ({ page, context }) => {
    const laptop = await openOnlineApp(page, context);
    const seen = await stubTasks(page, OWN_AI_GAP);
    await page.goto(`/schedule?projectId=${P1.id}`);

    await typeAndSend(page, "work out which trades will slip next month and why");
    await expect.poll(() => seen.posts.length).toBe(1);
    await expect(page.getByText("PROJEXA does not run its own AI", { exact: false }).first(), "the own-AI sentence was not shown").toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
    await page.waitForTimeout(1_500);
    expect(seen.posts).toHaveLength(1);
    expect(seen.posts[0].confirm).toBeUndefined();
    expect(modelRoutes(laptop.apiRequests), "the chat box reached a model route with PROJEXA's AI off").toEqual([]);
  });
});
