// LOCAL-FIRST slice 1 (owner directive 2026-10-02): the "Preparing your workspace"
// step shown on a user's FIRST login. During it (up to about 3 minutes) the app
// downloads itself onto this laptop and opens the laptop's local database, so
// later visits run from the laptop and need almost nothing from Vercel.
//
// Honest by construction: progress is driven by steps that really finished, never
// by a fake timer. The countdown is only a ceiling -- when the work is done the
// screen ends early, and if a step is slow the user is let through at the ceiling
// rather than being held. A failing step never blocks the user (the app still
// works from the server); it is reported so the screen can say what is missing.

export const PREPARE_BUDGET_MS = 3 * 60 * 1000;

export type StepId = "worker" | "app" | "database" | "projects";

export type PrepareStep = {
  id: StepId;
  label: string;
  /** Share of the progress bar this step is worth (all steps sum to 100). */
  weight: number;
  run: (ctx: { signal: AbortSignal; onDetail: (done: number, total: number) => void }) => Promise<void>;
};

export type StepState = "waiting" | "running" | "done" | "failed" | "skipped";

export type PrepareProgress = {
  percent: number;
  steps: { id: StepId; label: string; state: StepState; error?: string }[];
  elapsedMs: number;
  remainingMs: number;
  finished: boolean;
  timedOut: boolean;
};

export type PrepareDeps = {
  steps: PrepareStep[];
  now?: () => number;
  budgetMs?: number;
  onProgress: (progress: PrepareProgress) => void;
};

export type PrepareResult = {
  ready: boolean;
  timedOut: boolean;
  failed: StepId[];
  elapsedMs: number;
};

/**
 * Runs the steps one after another and reports real progress. `ready` is true only
 * when every step finished; a timeout or a failure yields ready=false so the next
 * visit tries again instead of pretending the laptop is prepared.
 */
export async function prepareWorkspace(deps: PrepareDeps): Promise<PrepareResult> {
  const now = deps.now ?? (() => Date.now());
  const budgetMs = deps.budgetMs ?? PREPARE_BUDGET_MS;
  const startedAt = now();
  const controller = new AbortController();
  const states = new Map<StepId, { state: StepState; error?: string; fraction: number }>(
    deps.steps.map((s) => [s.id, { state: "waiting", fraction: 0 }])
  );
  let timedOut = false;

  const snapshot = (finished: boolean): PrepareProgress => {
    const elapsedMs = Math.min(now() - startedAt, budgetMs);
    let percent = 0;
    for (const step of deps.steps) {
      const s = states.get(step.id)!;
      const share = s.state === "done" ? 1 : s.state === "running" ? s.fraction : 0;
      percent += step.weight * share;
    }
    return {
      percent: finished && !timedOut && [...states.values()].every((s) => s.state === "done") ? 100 : Math.min(99, Math.round(percent)),
      steps: deps.steps.map((s) => ({ id: s.id, label: s.label, state: states.get(s.id)!.state, error: states.get(s.id)!.error })),
      elapsedMs,
      remainingMs: Math.max(0, budgetMs - elapsedMs),
      finished,
      timedOut,
    };
  };

  const emit = (finished = false) => deps.onProgress(snapshot(finished));
  emit();

  const budget = new Promise<"budget">((resolve) => {
    const timer = setTimeout(() => resolve("budget"), budgetMs);
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });

  const work = (async () => {
    for (const step of deps.steps) {
      if (controller.signal.aborted) {
        states.get(step.id)!.state = "skipped";
        continue;
      }
      const s = states.get(step.id)!;
      s.state = "running";
      emit();
      try {
        await step.run({
          signal: controller.signal,
          onDetail: (d, t) => {
            s.fraction = t > 0 ? Math.min(1, d / t) : 0;
            emit();
          },
        });
        // The ceiling was hit while this step was running: it did not finish, so never call it done.
        if (controller.signal.aborted) {
          s.state = "skipped";
          continue;
        }
        s.state = "done";
        s.fraction = 1;
      } catch (err) {
        s.state = "failed";
        s.error = err instanceof Error ? err.message : String(err);
      }
      emit();
    }
    return "work" as const;
  })();

  const winner = await Promise.race([work, budget]);
  if (winner === "budget") {
    timedOut = true;
    controller.abort();
    for (const step of deps.steps) {
      const s = states.get(step.id)!;
      if (s.state === "running" || s.state === "waiting") s.state = "skipped";
    }
  } else {
    controller.abort(); // clears the budget timer
  }

  const failed = deps.steps.filter((s) => states.get(s.id)!.state === "failed").map((s) => s.id);
  const allDone = deps.steps.every((s) => states.get(s.id)!.state === "done");
  emit(true);
  return { ready: allDone && !timedOut, timedOut, failed, elapsedMs: Math.min(now() - startedAt, budgetMs) };
}

/** Per-user flag so a different person on the same laptop is prepared separately. */
export function readyKey(userId: string): string {
  return `px-workspace-ready-v1:${userId}`;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
