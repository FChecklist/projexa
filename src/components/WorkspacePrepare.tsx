"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/format-date";
import { localDbNameFor, openLocalDb } from "@/lib/local-first/local-db";
import { getSharedReplica } from "@/lib/local-first/replica-shared";
import type { Replica } from "@/lib/local-first/replica";
import {
  PREPARE_BUDGET_MS,
  formatCountdown,
  prepareWorkspace,
  readyKey,
  type PrepareProgress,
  type PrepareStep,
} from "@/lib/local-first/prepare-workspace";

// LOCAL-FIRST slice 1 (owner directive 2026-10-02). On a person's first login on a
// laptop, show a short "Preparing your workspace" screen (a 3-minute ceiling) while
// PROJEXA downloads itself onto this laptop and opens the laptop's local database.
// See src/lib/local-first/prepare-workspace.ts for why the progress is real.

/** The screens a person opens first; fetching them pulls their code onto the laptop. */
export const WARM_ROUTES = [
  "/dashboard",
  "/projects",
  "/schedule",
  "/work-progress",
  "/budgets",
  "/reports",
  "/documents",
  "/rfis",
  "/drawings",
  "/settings",
] as const;

const SEEN_KEY = "px-workspace-prepare-seen";

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** What the "copy your projects" step says when the sync did not finish; PROJEXA still works from the server. */
export function syncFailureMessage(report: { status: string; issues: { reason: string; message: string; projectId?: string }[] }): string {
  const first = report.issues[0];
  if (report.status === "signed_out") return "You are signed out, so your projects could not be copied. Sign in again.";
  if (first && !first.projectId && (first.reason === "not_found" || first.reason === "network" || first.reason === "timeout" || first.reason === "server")) {
    return "The laptop copy service is not reachable yet, so your projects will open from the server for now.";
  }
  return first?.message ?? "Some projects could not be copied to this laptop.";
}

export function buildSteps(userId: string, prefetch: (href: string) => void, replicaFor: (userId: string) => Replica = getSharedReplica): PrepareStep[] {
  return [
    {
      id: "worker",
      label: "Install PROJEXA on this laptop",
      weight: 15,
      run: async ({ signal }) => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
          throw new Error("This browser cannot keep PROJEXA on the laptop (no service worker).");
        }
        // Development servers never run the worker (see ServiceWorkerRegister); production does.
        if (process.env.NODE_ENV === "development") return;
        await navigator.serviceWorker.register("/sw.js");
        await Promise.race([navigator.serviceWorker.ready, pause(20_000, signal)]);
        if (!navigator.serviceWorker.controller && !(await navigator.serviceWorker.getRegistration())?.active) {
          throw new Error("The laptop worker did not start.");
        }
      },
    },
    {
      id: "app",
      label: "Download your screens",
      weight: 45,
      run: async ({ signal, onDetail }) => {
        let n = 0;
        for (const href of WARM_ROUTES) {
          if (signal.aborted) return;
          prefetch(href);
          n += 1;
          onDetail(n, WARM_ROUTES.length);
          await pause(250, signal); // let the browser fetch this screen's code before the next one
        }
      },
    },
    {
      id: "database",
      label: "Open your local database",
      weight: 10,
      run: async () => {
        const db = await openLocalDb(undefined, localDbNameFor(userId));
        try {
          await db.setMeta("workspace", { userId, preparedAt: Date.now(), schema: 1 });
        } finally {
          db.close();
        }
      },
    },
    {
      id: "projects",
      label: "Copy your projects to this laptop",
      weight: 30,
      run: async ({ signal, onDetail }) => {
        // Real progress: projects finished out of projects to copy. A service that is unreachable or not
        // deployed yet fails this one step (reported on the screen); PROJEXA keeps working from the server.
        const report = await replicaFor(userId).sync(signal, (p) => onDetail(p.projectsDone, p.projectsTotal));
        if (signal.aborted) return;
        if (report.status !== "done") throw new Error(syncFailureMessage(report));
      },
    },
  ];
}

export function WorkspacePrepareView({
  progress,
  onContinue,
  lastSyncedAt,
}: {
  progress: PrepareProgress;
  onContinue: () => void;
  /** When the projects were last copied to this laptop (ms since epoch); null when never. Omit to hide the line. */
  lastSyncedAt?: number | null;
}) {
  const icon = (s: string) => (s === "done" ? "✓" : s === "failed" ? "!" : s === "running" ? "…" : "·");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Preparing your workspace"
      data-testid="workspace-prepare"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-px-concrete p-6"
    >
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-lg">
        <h2 className="font-heading text-2xl text-px-ink">Preparing your workspace</h2>
        <p className="mt-2 text-sm text-px-muted">
          PROJEXA is being set up on this laptop so your projects open fast. This takes up to 3 minutes the first time only.
        </p>
        <div className="mt-6 flex items-baseline justify-between">
          <span data-testid="prepare-percent" className="text-3xl font-semibold text-px-ink">{progress.percent}%</span>
          <span data-testid="prepare-countdown" className="text-sm text-px-muted">
            {progress.finished ? "Done" : `${formatCountdown(progress.remainingMs)} left at most`}
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-px-concrete" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-px-orange transition-all" style={{ width: `${progress.percent}%` }} />
        </div>
        <ul className="mt-5 space-y-2 text-sm">
          {progress.steps.map((s) => (
            <li key={s.id} data-testid={`prepare-step-${s.id}`} data-state={s.state} className="flex gap-2 text-px-ink">
              <span aria-hidden className="w-4 text-center">{icon(s.state)}</span>
              <span>
                {s.label}
                {s.state === "failed" && s.error ? <span className="block text-xs text-red-700">{s.error}</span> : null}
              </span>
            </li>
          ))}
        </ul>
        {progress.finished && (progress.timedOut || progress.steps.some((s) => s.state === "failed")) ? (
          <p className="mt-4 text-xs text-px-muted">
            Some of this could not finish. PROJEXA still works; it will try again next time you sign in.
          </p>
        ) : null}
        {progress.finished && lastSyncedAt !== undefined ? (
          <p data-testid="prepare-last-synced" className="mt-3 text-xs text-px-muted">
            {lastSyncedAt ? `Last synced ${formatDateTime(lastSyncedAt)}` : "Projects not copied to this laptop yet"}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onContinue}
          data-testid="prepare-continue"
          className="mt-6 w-full rounded-lg bg-px-orange px-4 py-2.5 font-medium text-px-ink hover:opacity-90"
        >
          {progress.finished ? "Open PROJEXA" : "Skip for now"}
        </button>
      </div>
    </div>
  );
}

/**
 * Shown once per person per laptop. Mount it inside the signed-in layout; it renders
 * nothing when the laptop is already prepared or the person already skipped this session.
 */
export function WorkspacePrepare() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<PrepareProgress | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null | undefined>(undefined);
  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled || !data.user) return;
        try {
          if (localStorage.getItem(readyKey(data.user.id)) || sessionStorage.getItem(SEEN_KEY)) return;
        } catch {
          return; // storage blocked: do not trap the person behind a screen we cannot remember
        }
        setUserId(data.user.id);
        setOpen(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open || !userId || started.current) return;
    started.current = true;
    prepareWorkspace({
      steps: buildSteps(userId, (href) => router.prefetch(href)),
      budgetMs: PREPARE_BUDGET_MS,
      onProgress: setProgress,
    }).then((result) => {
      setLastSyncedAt(getSharedReplica(userId).getStatus().report?.syncedAt ?? null);
      try {
        if (result.ready) localStorage.setItem(readyKey(userId), String(Date.now()));
      } catch { /* ignore */ }
    });
  }, [open, userId, router]);

  const close = () => {
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
    setOpen(false);
  };

  if (!open || !progress) return null;
  return <WorkspacePrepareView progress={progress} onContinue={close} lastSyncedAt={lastSyncedAt} />;
}
