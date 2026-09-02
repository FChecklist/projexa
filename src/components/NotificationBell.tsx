"use client";

// Real notification bell + dropdown -- same UX pattern as
// compliance-tracker's AppTopbar.tsx notification section, backed by
// PROJEXA's own real GET /api/notifications + PATCH /api/notifications/
// [id]/read. Rendered via AppHeader's notificationSlot (see AppTopbar.tsx).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  metadata: { projectId?: string } | null;
  createdAt: string;
};

const ROUTE_BY_TYPE: Record<string, (projectId: string) => string> = {
  rfi_created: (projectId) => `/rfis?projectId=${encodeURIComponent(projectId)}`,
  submittal_status_changed: (projectId) => `/submittals?projectId=${encodeURIComponent(projectId)}`,
  punch_list_created: (projectId) => `/punch-list?projectId=${encodeURIComponent(projectId)}`,
};

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  // R67 F-21: normally supplied by the /api/shell bootstrap, so the bell costs
  // no request of its own. It keeps its own fetch for the case where the
  // bootstrap has not answered yet (or failed), so the bell is never silently
  // stuck on zero.
  initialNotifications?: NotificationItem[];
  initialUnreadCount?: number;
} = {}) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount ?? 0);
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications ?? []);
  // R66 code-quality fix: a failed load used to no-op silently, leaving the
  // bell showing 0 unread forever with nothing telling the user it didn't
  // actually load. This is a minimal, non-blocking indicator -- a title/
  // tooltip plus a distinct dot color -- not a full error-state redesign.
  const [failedToLoad, setFailedToLoad] = useState(false);

  // The bootstrap answers this for the whole session; only fetch when it did
  // not (a create route where the shell bootstrap is still deferred, or a
  // failed /api/shell).
  const seeded = initialNotifications !== undefined;
  useEffect(() => {
    if (seeded) {
      setNotifications(initialNotifications ?? []);
      setUnreadCount(initialUnreadCount ?? 0);
      return;
    }
    const controller = new AbortController();
    fetch("/api/notifications", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (controller.signal.aborted) return;
        if (!d) { setFailedToLoad(true); return; }
        setUnreadCount(d.unreadCount ?? 0);
        setNotifications(d.notifications ?? []);
      })
      .catch(() => { if (!controller.signal.aborted) setFailedToLoad(true); });
    return () => controller.abort();
  }, [seeded, initialNotifications, initialUnreadCount]);

  async function handleClick(n: NotificationItem) {
    if (!n.isRead) {
      fetch(`/api/notifications/${n.id}/read`, { method: "PATCH" }).catch(() => {});
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    const projectId = n.metadata?.projectId;
    const route = projectId && ROUTE_BY_TYPE[n.type] ? ROUTE_BY_TYPE[n.type](projectId) : "/dashboard";
    router.push(route);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-ct-muted hover:bg-ct-cloud hover:text-ct-navy"
          aria-label="Notifications"
          title={failedToLoad ? "Notifications failed to load" : undefined}
        >
          <Bell className="size-[18px]" />
          {failedToLoad ? (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-amber-500 ring-2 ring-white" />
          ) : unreadCount > 0 ? (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-red-500 ring-2 ring-white" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-3 py-4 text-sm text-ct-muted text-center">No notifications</div>
        ) : (
          notifications.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex-col items-start gap-0.5 whitespace-normal"
              onClick={() => handleClick(n)}
            >
              <div className="flex items-center gap-2 w-full">
                {!n.isRead && <span className="size-1.5 rounded-full bg-px-orange shrink-0" />}
                <span className="text-sm font-medium text-ct-navy">{n.title}</span>
              </div>
              <p className="text-xs text-ct-muted">{n.message}</p>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
