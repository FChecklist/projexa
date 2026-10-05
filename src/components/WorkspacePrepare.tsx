"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { localDbNameFor, openLocalDb } from "@/lib/local-first/local-db";
import { getSharedReplica } from "@/lib/local-first/replica-shared";
import { isLocalFirstEnabled } from "@/lib/local-first/local-reader";
import { LOCAL_DB_VERSION } from "@/lib/local-first/local-db";
import { getDeviceId } from "@/lib/local-first/outbox-shared";
import { accessToken, getReleaseVersion } from "@/lib/local-first/shared-client";
import { createReleaseClient } from "@/lib/local-first/release/release-client";
import { createPrepareReporter, type PrepareReport } from "@/lib/local-first/prepare-report";
import { MANIFEST_KEY, type Replica } from "@/lib/local-first/replica";
import { announceShellReady, markCopying } from "@/lib/local-first/release/shell-handoff";
import { SYNC_BUSY_MESSAGE } from "@/lib/local-first/sync-busy";
import {
  PREPARE_BUDGET_MS,
  prepareWorkspace,
  readyKey,
  type PrepareProgress,
  type PrepareStep,
  type StepId,
} from "@/lib/local-first/prepare-workspace";

// LOCAL-FIRST slice 1 (owner directive 2026-10-02). On a person's first login on a
// laptop, show a short "Preparing your workspace" screen (a 3-minute ceiling) while
// PROJEXA downloads itself onto this laptop and opens the laptop's local database.
// See src/lib/local-first/prepare-workspace.ts for why the progress is real.
//
// COST (package lf-fc, review cost:COST-02 / FLAG-16): the copy of the projects is the most expensive thing the client does
// (one request per project x kind on the first sync), and with the local-first flag (`px-local-first`) OFF nothing ever reads
// that copy. So with the flag off this component is INERT: it does not ask who is signed in, opens nothing, shows nothing and
// sends nothing; and buildSteps leaves the "projects" step out entirely. A visitor who is not signed in never starts it either.

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

/** After an incomplete run the screen starts again by itself after this long. */
export const RETRY_AFTER_MS = 15_000;

const SEEN_KEY = "px-workspace-prepare-seen";
/**
 * "This person skipped the screen in this tab". PER PERSON (lf-e11): it was one key for the whole tab, so after a sign-out the NEXT person
 * to sign in on the same tab never got their workspace prepared (found by the real-browser run of two people on one laptop).
 */
export const seenKey = (userId: string) => `${SEEN_KEY}:${userId}`;

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

async function defaultInstallApp(userId: string, onDetail: (done: number, total: number) => void, localFirstOn: () => boolean) {
  const { runBrowserVerifiedInstall } = await import("@/lib/local-first/release/verified-install-browser");
  return runBrowserVerifiedInstall(userId, localFirstOn, onDetail);
}

const BUSY_RETRIES = 60;
const BUSY_WAIT_MS = 1_000;
/** A sync that did not run because another one of this person holds the lock. */
export function isBusyReport(report: { status: string; issues: { message: string; projectId?: string }[] }): boolean {
  return report.status === "idle" && report.issues.some((i) => !i.projectId && i.message === SYNC_BUSY_MESSAGE);
}

export function buildSteps(
  userId: string,
  prefetch: (href: string) => void,
  replicaFor: (userId: string) => Replica = getSharedReplica,
  /** The local-first flag. Off: the "projects" step (the replica's whole sync) is not part of the plan at all. */
  localFirstOn: () => boolean = isLocalFirstEnabled,
  /**
   * The verified browser install (release/verified-install.ts): resolves only when the release is installed in Cache Storage with every digest
   * verified, the worker controls the page and persistent storage was asked for; throws (with a reason) otherwise. Injected so tests need no browser.
   */
  installApp: (userId: string, onDetail: (done: number, total: number) => void, localFirstOn: () => boolean) => Promise<unknown> = defaultInstallApp,
  /** Development servers have no release bundle to install (see ServiceWorkerRegister); tests can force either branch. */
  isDevelopment: boolean = process.env.NODE_ENV === "development",
): PrepareStep[] {
  const steps: PrepareStep[] = [
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
        if (isDevelopment) {
          // `next dev` builds no release bundle and never runs the worker: the only thing to do is warm the dev server's routes.
          let n = 0;
          for (const href of WARM_ROUTES) {
            if (signal.aborted) return;
            prefetch(href);
            n += 1;
            onDetail(n, WARM_ROUTES.length);
            await pause(250, signal);
          }
          return;
        }
        // Production: a REAL install, not a warm-up. This step is done only when the release is verified in Cache Storage, the worker controls
        // the page and persistent storage was asked for; any failure fails the step, so the screen stays, reports why and retries (RETRY_AFTER_MS).
        await installApp(userId, onDetail, localFirstOn);
        if (signal.aborted) return;
        // The HTTP-cache warm-up is kept as a cheap extra for the first visit of a screen that has no /local shell (it fetches nothing the install did not verify).
        // AUDIT-100 A3: in local-first mode the installed shell answers these screens from the laptop, so warming them on the server would only be ten
        // Vercel page renders (RSC prefetches) nobody uses; it is kept for the flag-off path only.
        if (!localFirstOn()) for (const href of WARM_ROUTES) prefetch(href);
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
        // The sync lock is per person and "ifAvailable": a screen's own catch-up (a page that opened first and revalidates its project) can hold it
        // for a moment, and the replica then answers "busy" without copying anything. That is not a failure of the laptop, and it is not done
        // either: wait and ask again (found by e2e/lf-lifecycle-monitor.spec.ts once the install step delayed this one).
        let report = await replicaFor(userId).sync(signal, (p) => onDetail(p.projectsDone, p.projectsTotal));
        for (let tries = 0; tries < BUSY_RETRIES && !signal.aborted && isBusyReport(report); tries += 1) {
          await pause(BUSY_WAIT_MS, signal);
          if (signal.aborted) return;
          report = await replicaFor(userId).sync(signal, (p) => onDetail(p.projectsDone, p.projectsTotal));
        }
        if (signal.aborted) return;
        if (report.status === "done") return;
        // A project that cannot be read is a matter of that project's data, not of the laptop being ready: the person is let in once the
        // service answered and every project it could copy is copied. Anything else (service unreachable, signed out) keeps the screen up.
        const onlyProjectIssues = report.status === "partial" && report.issues.length > 0 && report.issues.every((i) => i.projectId);
        if (!onlyProjectIssues) throw new Error(syncFailureMessage(report));
      },
    },
  ];
  // Flag off: nothing reads the laptop copy, so copying it would be pure cost (cost:COST-02).
  return localFirstOn() ? steps : steps.filter((s) => s.id !== "projects");
}

/** The reporter that tells OUR side how this laptop's preparation is going (prepare-report.ts): the sync service, and this site's own log as the second line. */
export function createLiveReporter() {
  const client = createReleaseClient({ getAccessToken: accessToken, clientVersion: getReleaseVersion, schema: LOCAL_DB_VERSION });
  return createPrepareReporter({
    deviceId: getDeviceId(),
    release: () => {
      const v = getReleaseVersion();
      return v && v.length <= 40 ? v : null;
    },
    send: (r: PrepareReport) => client.reportPrepare(r as unknown as Record<string, unknown>),
    beacon: (r: PrepareReport) => {
      try {
        navigator.sendBeacon?.("/api/local-first/prepare-report", new Blob([JSON.stringify(r)], { type: "application/json" }));
      } catch { /* the sync service is the main line */ }
    },
  });
}

export function WorkspacePrepareView({ progress }: { progress: PrepareProgress; lastSyncedAt?: number | null }) {
  // MANDATORY and QUIET (owner directive 2026-10-03): the title, one sentence and the percentage. No step list, no errors, no buttons:
  // nothing to skip and nothing to press. It opens PROJEXA by itself at 100% (WorkspacePrepare); after a failure it simply tries again.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Preparing your PROJEXA workspace"
      data-testid="workspace-prepare"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-[#E0F4FF] via-[#F3EBFF] to-[#FFEFD9] p-6"
    >
      <div className="w-full max-w-md rounded-2xl border-2 border-[#7DD3FC] bg-white p-8 shadow-lg">
        <h2 className="font-heading text-2xl text-px-ink">Preparing your PROJEXA workspace</h2>
        <p className="mt-2 text-sm text-px-muted">
          PROJEXA workspace is being set up on this laptop so your projects open fast. This takes up to 3 minutes the first time only.
        </p>
        <div className="mt-6">
          <span data-testid="prepare-percent" className="text-3xl font-semibold text-[#0284C7]">{progress.percent}%</span>
        </div>
        <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-[#E0F2FE]" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-gradient-to-r from-[#FF8A1F] via-[#FF4F9A] to-[#8B5CF6] transition-all" style={{ width: `${progress.percent}%` }} />
        </div>
      </div>
    </div>
  );
}

/** True only when every step finished within the budget. */
export function isPrepared(progress: PrepareProgress): boolean {
  return progress.finished && !progress.timedOut && progress.steps.every((s) => s.state === "done");
}

/**
 * The ONE-TIME part is done: PROJEXA is installed on this laptop (worker, screens, local database). That is the condition that lets the
 * person in and is remembered for good. Copying the projects is NOT part of it: it can take longer, can fail for a reason that is not the
 * laptop's (the account has no project yet, the sync service is down) and carries on quietly in the background (see quietCopy).
 */
export function isInstalled(progress: PrepareProgress): boolean {
  const need: StepId[] = ["worker", "app", "database"];
  return need.every((id) => progress.steps.find((s) => s.id === id)?.state === "done");
}

/** Waits between quiet attempts to copy the projects: 15 s, 30 s, 60 s ... never more than 10 minutes. */
export function quietRetryDelay(attempt: number): number {
  return Math.min(RETRY_AFTER_MS * 2 ** Math.max(0, attempt), 10 * 60_000);
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
  const [attempt, setAttempt] = useState(0);
  const reporter = useRef<ReturnType<typeof createLiveReporter> | null>(null);
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quietStopped = useRef(false);

  /** Copies the projects with NOTHING on screen, retrying with a growing wait, until the laptop holds them (or the page closes). */
  function quietCopy(uid: string, attemptNo = 0) {
    if (quietStopped.current) return;
    void (async () => {
      try {
        const db = await openLocalDb(undefined, localDbNameFor(uid));
        let has = false;
        try { has = (await db.getMeta(MANIFEST_KEY)) !== undefined; } finally { db.close(); }
        if (has || quietStopped.current) return;
        const copied = markCopying();
        let report: Awaited<ReturnType<Replica["sync"]>>;
        try {
          report = await getSharedReplica(uid).sync(new AbortController().signal, () => {});
        } finally {
          copied();
        }
        if (report.status === "done") announceShellReady();
        if (report.status === "done" || quietStopped.current) return;
      } catch { /* never bother the person */ }
      if (quietStopped.current) return;
      quietTimer.current = setTimeout(() => quietCopy(uid, attemptNo + 1), quietRetryDelay(attemptNo));
    })();
  }

  useEffect(() => {
    let cancelled = false;
    // Flag off: inert (no Supabase call, no modal, no database, no sync request). See the header.
    if (!isLocalFirstEnabled()) return;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled || !data.user) return;
        try {
          if (localStorage.getItem(readyKey(data.user.id)) || sessionStorage.getItem(seenKey(data.user.id))) {
            // Installed before: never the full screen again. If the projects were never copied, carry on quietly.
            quietCopy(data.user.id);
            return;
          }
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    // OUR side watches every run: stage, percentage, heartbeat, failures with their reason (prepare-report.ts)
    if (!reporter.current) {
      try { reporter.current = createLiveReporter(); reporter.current.start(); } catch { /* reporting must never stop the preparation */ }
    } else {
      reporter.current.retry();
    }
    const copying = markCopying();
    prepareWorkspace({
      steps: buildSteps(userId, (href) => router.prefetch(href)),
      budgetMs: PREPARE_BUDGET_MS,
      onProgress: (p) => {
        setProgress(p);
        try { reporter.current?.progress(p); } catch { /* ignore */ }
      },
    }).then((result) => {
      copying();
      setLastSyncedAt(getSharedReplica(userId).getStatus().report?.syncedAt ?? null);
      try {
        if (result.ready) localStorage.setItem(readyKey(userId), String(Date.now()));
      } catch { /* ignore */ }
      // The install itself did not finish (no worker, screens not downloaded): try again by itself, the screen stays.
      // Only the projects copy missing is NOT a reason to hold the person: it carries on quietly.
      const installed = !(result.failed ?? []).some((id) => id !== "projects") && !result.timedOut;
      // AUDIT-100 A3 (VERCEL_ROUTE_PLAN.md step 1): the shell is on the laptop now; LocalShellHandoff moves this person off the server-rendered page
      // (one replace, answered by the service worker) instead of leaving the rest of the first session on Vercel. After the projects step, never
      // during it: the copy runs in this page.
      if (installed) announceShellReady();
      if (!result.ready && installed) {
        try { localStorage.setItem(readyKey(userId), String(Date.now())); } catch { /* ignore */ }
        quietCopy(userId);
      } else if (!result.ready) {
        timer = setTimeout(() => { started.current = false; setAttempt((n) => n + 1); }, RETRY_AFTER_MS);
      }
    });
    return () => { if (timer) clearTimeout(timer); };
  }, [open, userId, router, attempt]);

  const close = () => {
    try { if (userId) sessionStorage.setItem(seenKey(userId), "1"); } catch { /* ignore */ }
    setOpen(false);
  };

  useEffect(() => {
    quietStopped.current = false;
    return () => {
    reporter.current?.stop();
    reporter.current = null;
    quietStopped.current = true;
    if (quietTimer.current) clearTimeout(quietTimer.current);
    };
  }, []);

  // The person is let in the moment the install is done (not when the projects are copied), and it is remembered for good.
  const installed = progress ? isInstalled(progress) : false;
  useEffect(() => {
    if (!installed) return;
    try { if (userId) localStorage.setItem(readyKey(userId), String(Date.now())); } catch { /* ignore */ }
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed]);

  if (!open || !progress) return null;
  return <WorkspacePrepareView progress={progress} lastSyncedAt={lastSyncedAt} />;
}
