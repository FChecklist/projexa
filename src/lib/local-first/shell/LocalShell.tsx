"use client";

// LOCAL-FIRST shell: the static, client-rendered app that runs from this laptop. ONE prerendered document (src/app/local) draws
// whatever app URL it was opened at, from:
//   * the durable identity kept on the laptop (no Supabase call),
//   * the replica's manifest + the cached project names (the organisation and the project switcher),
//   * the route table (route-table.ts): path -> lazy screen + a data adapter that reads the local database.
//
// It reads NO server data: nothing here uses cookies, headers or a server module (local-shell-static.test.ts proves it from the
// import graph). A path that is not in the route table is opened from the server when the laptop can reach it (the same screen,
// marked so the service worker does not hand the shell back) and explained calmly when it cannot.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { PeerSyncMarker } from "@/components/PeerSyncMarker";
import { ConnectivityMarker } from "@/components/local-first/ConnectivityMarker";
import { OutboxAttention } from "@/components/OutboxAttention";
import type { Outbox } from "../outbox";
import { AiAttach } from "../ai/AiAttach";
import { LocalShellAiBar } from "./LocalShellAiBar";
import { LocalShellAccount } from "./LocalShellAccount";
import { getConnectivity, reportServerFailure, reportServerSuccess, useConnectivity } from "../connectivity";
import { deviceMetaStore, openDeviceMeta, personMetaStore } from "../device-meta";
import { createIdentityStore, getDurableIdentity, mirrorSession, type DurableIdentity } from "../identity";
import { BOQ_LINES_KIND } from "../boq-local";
import { chooseProject, readShellData, selectedProjectKey, type ShellData } from "./context";
import { serverPageUrl, type ShellLocation } from "./paths";
import { createEditQueue, createFlushScheduler, type FlushResult, type ShellWriter } from "./pending-edits";
import { findShellRoute, navRoutes } from "./route-table";
import { interceptLinkClick, useShellLocation } from "./router";
import { connectShellOutbox, shellShowsOutboxCard, type ShellOutbox } from "./shell-outbox";
import type { ShellApi, ShellRoute, ShellScreenProps } from "./types";
import { useServerRedirect } from "./server-redirect";

type Boot =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "ready"; identity: DurableIdentity; data: ShellData };

function Skeleton() {
  return <div data-testid="local-shell-skeleton" aria-busy="true" className="min-h-screen bg-px-concrete" />;
}

/**
 * Reads the person and what this laptop holds for them. The identity comes from storage ONLY (no network, no Supabase): that is what
 * lets the shell open offline. Only when the laptop holds no identity at all AND is online is the Supabase session consulted once, to
 * mirror an identity that was never mirrored here -- otherwise a person who is signed in would be sent to /login, which would send
 * them straight back, forever.
 */
async function readBoot(): Promise<Boot> {
  const store = createIdentityStore({ storage: typeof localStorage === "undefined" ? null : localStorage, openMeta: () => openDeviceMeta() });
  let identity = await getDurableIdentity(store);
  if (!identity && typeof navigator !== "undefined" && navigator.onLine !== false) {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const { data } = await createClient().auth.getSession();
      if (data.session) identity = await mirrorSession(store, data.session);
    } catch {
      /* no session to mirror */
    }
  }
  if (!identity) return { status: "signed_out" };
  return { status: "ready", identity, data: await readShellData({ identity, deviceMeta: deviceMetaStore() }) };
}

const LOGIN_REDIRECT_GUARD = "px-shell-login-redirect-at";

/** True at most once every ten seconds: a redirect loop must end in a visible link, never in a spinning tab. */
function mayRedirectToLogin(now: number): boolean {
  try {
    const last = Number(sessionStorage.getItem(LOGIN_REDIRECT_GUARD) ?? 0);
    if (now - last < 10_000) return false;
    sessionStorage.setItem(LOGIN_REDIRECT_GUARD, String(now));
  } catch {
    /* storage blocked: allow it */
  }
  return true;
}

export default function LocalShell() {
  const { location, navigate } = useShellLocation();
  const connectivity = useConnectivity();
  const [boot, setBoot] = useState<Boot>({ status: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [remembered, setRemembered] = useState<string | null>(null);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    void readBoot().then((b) => {
      if (!cancelled) setBoot(b);
    });
    return () => { cancelled = true; };
  }, []);

  // The shell has its own connectivity marker in its header; the floating one in the root layout stays out of the way while it is on screen.
  useEffect(() => {
    document.documentElement.dataset.pxShell = "1";
    return () => {
      delete document.documentElement.dataset.pxShell;
    };
  }, []);

  const userId = boot.status === "ready" ? boot.data.userId : null;

  useEffect(() => {
    if (!userId) return;
    try {
      setRemembered(localStorage.getItem(selectedProjectKey(userId)));
    } catch {
      setRemembered(null);
    }
  }, [userId]);

  // lf-e11: the person's OUTBOX resumes here too, as in the (app) shell (M24Shell). Changes made offline -- by the person's screens or by
  // their AI -- and then a reload or a page opened offline left their ops in IndexedDB with nothing to send them: the outbox was only
  // created by the next write, so its `online` handler never ran and the work stayed on the laptop after the connection came back.
  useEffect(() => {
    if (!userId) return;
    void import("../outbox-shared").then((m) => m.startOutbox(userId)).catch(() => {});
  }, [userId]);

  // AUDIT-37 (points 7, 8): the auto-sync scheduler + laptop-to-laptop peers were built but never started anywhere, so no laptop
  // caught up with the server or talked to a colleague's laptop after its first copy. One leader tab per browser (Web Lock).
  useEffect(() => {
    if (!userId) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void import("../peer/peer-shared").then((m) => {
      if (cancelled) return;
      m.startPeerSync(userId);
      stop = () => m.stopPeerSync(userId);
    }).catch(() => {});
    return () => { cancelled = true; stop?.(); };
  }, [userId]);

  // No identity on this laptop: online, the person signs in once; offline there is nothing to do but say so.
  useEffect(() => {
    if (boot.status !== "signed_out" || !location || connectivity !== "online") return;
    if (!mayRedirectToLogin(Date.now())) return;
    window.location.replace(`/login?redirectTo=${encodeURIComponent(location.path)}`);
  }, [boot.status, location, connectivity]);

  // The writer: keeps edits on the laptop, sends them when it can, and brings the replica up to date after.
  const schedulerRef = useRef<ReturnType<typeof createFlushScheduler> | null>(null);
  const writer = useMemo<ShellWriter | null>(() => {
    if (boot.status !== "ready") return null;
    const base = createEditQueue({ meta: personMetaStore(boot.data.userId, boot.data.idb) });
    return {
      ...base,
      async enqueue(edit) {
        const saved = await base.enqueue(edit);
        schedulerRef.current?.nudge();
        return saved;
      },
    };
  }, [boot]);

  useEffect(() => {
    if (!writer || boot.status !== "ready") return;
    const person = boot.data.userId;
    const send = async (): Promise<FlushResult> => {
      const before = await writer.list();
      const result = await writer.flush();
      if (result.sent > 0) {
        reportServerSuccess();
        // The server's version of what was just sent replaces the laptop's copy. The screen waits for that (so it does not flicker
        // back to the old value), but never longer than a couple of seconds, and is redrawn again when the pull really finishes.
        const pulls = [...new Set(before.map((e) => e.projectId))].map(async (projectId) => {
          try {
            const { revalidateViaSharedReplica } = await import("../replica-shared");
            await revalidateViaSharedReplica({ kind: BOQ_LINES_KIND, projectId, userId: person });
          } catch {
            /* the next sync brings it */
          }
        });
        const pulled = Promise.all(pulls);
        await Promise.race([pulled, new Promise((resolve) => setTimeout(resolve, 2500))]);
        refresh();
        void pulled.then(() => refresh());
      } else if (result.stoppedBecause === "offline" || result.stoppedBecause === "server") {
        reportServerFailure();
      }
      if (result.rejected > 0) refresh();
      return result;
    };
    const scheduler = createFlushScheduler({ writer: { list: writer.list, flush: send }, isOnline: () => getConnectivity() === "online" });
    schedulerRef.current = scheduler;
    scheduler.nudge();
    return () => {
      scheduler.stop();
      schedulerRef.current = null;
    };
  }, [writer, boot, refresh]);

  // The person's outbox (every screen's writes but the BOQ edit queue above): started as soon as the shell knows who they are, so what
  // a reload left waiting is sent when the laptop is back online (shell-outbox.ts says why this was missing).
  const outboxRef = useRef<ShellOutbox<Outbox> | null>(null);
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live: ShellOutbox<Outbox> | null = null;
    let cancelled = false;
    void import("../outbox-shared").then(({ getSharedOutbox }) => {
      if (cancelled) return;
      live = connectShellOutbox(userId, { getOutbox: getSharedOutbox, onSettled: refresh });
      outboxRef.current = live;
      setOutbox(live.outbox);
    }).catch(() => {
      /* the outbox could not load: edits stay stored and are sent by the next page load */
    });
    return () => {
      cancelled = true;
      live?.stop();
      if (outboxRef.current === live) outboxRef.current = null;
      setOutbox(null);
    };
  }, [userId, refresh]);

  // Back online: send what waited. The person coming back to the tab is a good moment to try again too (one try, no timer storm).
  useEffect(() => {
    if (connectivity === "online") {
      schedulerRef.current?.nudge({ immediate: true });
      outboxRef.current?.nudge();
    }
  }, [connectivity]);
  useEffect(() => {
    const onFocus = () => {
      schedulerRef.current?.nudge({ immediate: true });
      outboxRef.current?.nudge();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const matched = useMemo(() => (location ? findShellRoute(location.path) : null), [location]);

  useEffect(() => {
    if (location && typeof document !== "undefined") document.title = `${matched?.route.title ?? "PROJEXA"} · PROJEXA`;
  }, [location, matched]);

  if (!location || boot.status === "loading") return <Skeleton />;

  if (boot.status === "signed_out") {
    return (
      <Chrome navigate={navigate}>
        <section data-testid="local-shell-signed-out" className="mx-auto max-w-md pt-16 text-center">
          <h1 className="font-heading text-2xl text-px-ink">Sign in to PROJEXA</h1>
          <p className="mt-3 text-sm text-px-muted">
            {connectivity === "online"
              ? "Taking you to sign in…"
              : "PROJEXA needs you to sign in once on this laptop, while it is online. After that it keeps you signed in and works without a connection."}
          </p>
          <p className="mt-4 text-sm"><a className="text-px-ink underline underline-offset-2" href={`/login?redirectTo=${encodeURIComponent(location.path)}`}>Sign in</a></p>
        </section>
      </Chrome>
    );
  }

  const data = boot.data;
  const projectId = chooseProject(data.projects, new URLSearchParams(location.search).get("projectId"), remembered);

  const shell: ShellApi = {
    data,
    projectId,
    setProjectId(id) {
      try {
        localStorage.setItem(selectedProjectKey(data.userId), id);
      } catch {
        /* the choice just is not remembered */
      }
      setRemembered(id);
      const next = new URLSearchParams(location.search);
      if (next.has("projectId")) next.set("projectId", id);
      navigate(`${location.path}${next.toString() ? `?${next.toString()}` : ""}`, { replace: true });
      refresh();
    },
    writer: writer!,
    navigate,
    connectivity,
    refresh,
  };

  return (
    <Chrome navigate={navigate} data={data} shell={shell} locationPath={location.path}>
      {/* LOCAL-FIRST browser AI (R11, lf-e11): the same doors as every signed-in (app) page, for the person kept on this laptop -- this
          shell is what opens with no internet, so without it a person's AI could not work offline at all. */}
      <AiAttach userId={data.userId} />
      <PeerSyncMarker className="px-2 py-1" />
      {location.path === "/" ? (
        <Home shell={shell} />
      ) : matched ? (
        <ScreenHost key={`${location.path}${location.search}`} route={matched.route} params={matched.params} search={location.search} shell={shell} refreshKey={refreshKey} projectKey={projectId} />
      ) : (
        <NotInShell location={location} online={connectivity === "online"} />
      )}
      {outbox && shellShowsOutboxCard(matched?.route.pattern ?? null) ? <OutboxAttention key={data.userId} outbox={outbox} /> : null}
    </Chrome>
  );
}

// ─── the chrome ─────────────────────────────────────────────────────────────────────────────────

const NEW_PROJECT = "__new_project__";

function Chrome({ children, navigate, data, shell, locationPath }: { children: React.ReactNode; navigate: (href: string) => void; data?: ShellData; shell?: ShellApi; locationPath?: string }) {
  const nav = navRoutes();
  return (
    <div
      data-testid="local-shell"
      data-org-id={data?.orgId ?? undefined}
      className="min-h-screen bg-px-concrete text-px-ink"
      onClick={(event) => {
        interceptLinkClick(event, (href) => navigate(href), window.location.origin);
      }}
    >
      <header className="border-b-2 border-[#7DD3FC] bg-gradient-to-r from-[#E0F4FF] via-[#F3EBFF] to-[#FFEFD9] px-4 py-2">
        {/* Row 1: brand, project, and (always at the top right) the AI link, connection state and who is signed in. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="/" className="font-heading text-xl font-semibold text-[#0284C7]">PROJEXA</a>
          {data && shell ? (
            <label className="flex items-center gap-2 text-xs text-px-muted">
              <span>Project</span>
              <select
                aria-label="Project"
                data-testid="local-shell-project"
                className="max-w-[16rem] rounded-md border-2 border-[#38BDF8] bg-white px-2 py-1 text-sm font-medium text-[#0369A1]"
                value={shell.projectId ?? ""}
                onChange={(e) => {
                  if (e.target.value === NEW_PROJECT) {
                    navigate("/projects/new");
                    return;
                  }
                  shell.setProjectId(e.target.value);
                }}
              >
                {data.projects.length === 0 ? <option value="">No project on this laptop yet</option> : null}
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value={NEW_PROJECT}>+ New project</option>
              </select>
              {data.projects.length === 0 ? (
                <span data-testid="local-shell-no-projects" className="max-w-[22rem] text-px-muted">
                  This account has no project copied to this laptop, so there is nothing to choose yet.
                </span>
              ) : null}
            </label>
          ) : null}
          <div className="ml-auto flex max-w-full flex-wrap items-start gap-x-4 gap-y-2 text-xs text-px-muted">
            {data && shell ? <LocalShellAiBar role={data.role} project={data.projects.find((p) => p.id === shell.projectId) ?? null} online={shell.connectivity === "online"} /> : null}
            <ConnectivityMarker />
            {data ? <LocalShellAccount data={data} /> : null}
          </div>
        </div>
        {/* Row 2: the modules; scrolls sideways on a narrow screen instead of pushing the account control down. */}
        <nav aria-label="Modules" className="mt-2 flex items-center gap-4 overflow-x-auto whitespace-nowrap pb-1 text-sm">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`rounded-full px-3 py-1 transition-colors hover:bg-[#BAE6FD] ${locationPath === item.href || (locationPath ?? "").startsWith(`${item.href}/`) ? "bg-[#38BDF8] font-semibold text-white" : "text-[#0369A1]"}`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}

function Home({ shell }: { shell: ShellApi }) {
  const nav = navRoutes();
  return (
    <section data-testid="local-shell-home">
      <h1 className="font-heading text-2xl text-px-ink">PROJEXA on this laptop</h1>
      <p className="mt-2 text-sm text-px-muted">
        {shell.data.projects.length === 0
          ? "Your projects are not on this laptop yet. Open PROJEXA once while you are online and they will be copied here."
          : `${shell.data.projects.length} ${shell.data.projects.length === 1 ? "project is" : "projects are"} saved on this laptop.`}
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {nav.map((item) => (
          <li key={item.href}>
            <a className="text-px-ink underline underline-offset-2" href={item.href}>{item.label}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── a screen from the route table ─────────────────────────────────────────────────────────────

type HostState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; Component: ComponentType<ShellScreenProps<any>>; data: unknown };

function ScreenHost({ route, params, search, shell, refreshKey, projectKey }: { route: ShellRoute; params: Record<string, string>; search: string; shell: ShellApi; refreshKey: number; projectKey: string | null }) {
  // Stable for as long as the URL is: an effect that depends on `query` must not re-run on every render.
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const [state, setState] = useState<HostState>({ status: "loading" });
  // The component is loaded once per screen; the adapter runs again whenever the data may have changed.
  const [Component, setComponent] = useState<ComponentType<ShellScreenProps<any>> | null>(null);
  const latestShell = useRef(shell);
  // Updated in an effect (not during render); effects run in order, so this one is before the adapter effect below.
  useEffect(() => {
    latestShell.current = shell;
  });

  useEffect(() => {
    let cancelled = false;
    void route.load().then((m) => {
      if (!cancelled) setComponent(() => m.default);
    }).catch(() => {
      if (!cancelled) setState({ status: "error" });
    });
    return () => { cancelled = true; };
  }, [route]);

  useEffect(() => {
    if (!Component) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = route.adapter ? await route.adapter(latestShell.current, params, query) : undefined;
        if (!cancelled) setState({ status: "ready", Component, data });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [Component, route, refreshKey, projectKey, params, query]);

  if (state.status === "error") {
    return (
      <p data-testid="local-shell-error" className="text-sm text-px-muted">
        This screen could not be read from this laptop just now. Please try again in a moment.
      </p>
    );
  }
  if (state.status === "loading") return <p data-testid="local-shell-loading" aria-busy="true" className="text-sm text-px-muted">Loading…</p>;
  const Ready = state.Component;
  return <Ready shell={shell} params={params} query={query} data={state.data} />;
}

/** A path the shell has no screen for: the server's page when the laptop can reach it, a calm explanation when it cannot. */
function NotInShell({ location, online }: { location: ShellLocation; online: boolean }) {
  const serverUrl = serverPageUrl(location);
  useServerRedirect(online, serverUrl);
  return (
    <section data-testid="local-shell-not-here" data-online={online ? "1" : "0"}>
      <h1 className="font-heading text-2xl text-px-ink">Not on this laptop yet</h1>
      <p className="mt-3 text-sm text-px-muted">
        {online ? "Opening this screen from the server…" : "This screen is not saved on this laptop yet. It will open when you are connected."}
      </p>
      <p className="mt-3 text-sm">
        {online ? <a className="text-px-ink underline underline-offset-2" href={serverUrl}>Open it now</a> : <a className="text-px-ink underline underline-offset-2" href="/">Back to PROJEXA on this laptop</a>}
      </p>
    </section>
  );
}
