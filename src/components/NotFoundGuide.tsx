"use client";

// 404 and 403 pages, in full. Both give the same three ways out -- "Go back" (to the page the person came from), "Take me home" (the dashboard) and
// "Take me to my last project" (the project they last had selected on this device) -- plus the reason and who to ask. The panel is inline; nothing
// pops up. Used by app/not-found.tsx and by screens that refuse a role (AccessDenied).

import { useEffect, useState } from "react";
import { GuidedPanel, type PanelAction } from "@/components/GuidedPanel";
import { readSelectedProjectId } from "@/lib/project-cookie";

function useLastProject(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setId(readSelectedProjectId());
    } catch {
      setId(null);
    }
  }, []);
  return id;
}

/** The three ways out, as buttons. "Go back" only when there is a page to go back to. */
function useWayOut(): PanelAction[] {
  const last = useLastProject();
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => setCanGoBack(typeof window !== "undefined" && window.history.length > 1), []);
  const actions: PanelAction[] = [];
  if (canGoBack) actions.push({ id: "back", label: "Go back", primary: true, onClick: () => window.history.back() });
  actions.push({ id: "home", label: "Take me home", onClick: () => window.location.assign("/dashboard") });
  if (last) actions.push({ id: "last-project", label: "Take me to my last project", onClick: () => window.location.assign(`/dashboard?projectId=${encodeURIComponent(last)}`) });
  return actions;
}

export function NotFoundGuide() {
  const actions = useWayOut();
  // read after hydration (the server does not know the address the browser asked for)
  const [path, setPath] = useState("this address");
  useEffect(() => setPath(`${window.location.pathname}${window.location.search}`), []);
  return (
    <div className="mx-auto max-w-2xl p-6" data-testid="not-found-page">
      <GuidedPanel ctx={{ route: path.split("?")[0] || "/", search: "", code: "PAGE_NOT_FOUND", serverMessage: path }} actions={actions} fix={null} quiet />
    </div>
  );
}

/** A screen refused because of the role: who to ask, the exact place they do it, and the three ways out. */
export function AccessDenied({ code = "PAGE_FORBIDDEN", message, testId = "access-denied" }: { code?: "PAGE_FORBIDDEN" | "SYSTEM_LOG_OWNER_ONLY"; message?: string; testId?: string }) {
  const actions = useWayOut();
  return (
    <div data-testid={testId} className="max-w-2xl">
      <GuidedPanel ctx={{ route: typeof window === "undefined" ? "/" : window.location.pathname, search: "", code, serverMessage: message ?? "Your role does not include this page." }} actions={actions} quiet />
    </div>
  );
}
