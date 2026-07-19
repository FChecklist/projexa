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

export function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setUnreadCount(d.unreadCount ?? 0);
        setNotifications(d.notifications ?? []);
      })
      .catch(() => {});
  }, []);

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
        >
          <Bell className="size-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-red-500 ring-2 ring-white" />
          )}
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
