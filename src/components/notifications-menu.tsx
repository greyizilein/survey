import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notifications.functions";

type Notification = {
  id: string;
  title: string;
  body: string | null;
  level: "info" | "success" | "warning" | "error";
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const LEVEL_DOT: Record<Notification["level"], string> = {
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-destructive",
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const POLL_MS = 30000;

export function NotificationsMenu({ className }: { className?: string }) {
  const listFn = useServerFn(listNotifications);
  const markReadFn = useServerFn(markNotificationRead);
  const markAllReadFn = useServerFn(markAllNotificationsRead);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  async function refresh() {
    const { notifications: rows } = await listFn();
    setNotifications(rows as Notification[]);
  }

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  async function handleOpen(n: Notification) {
    if (!n.read_at) {
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
      await markReadFn({ data: { id: n.id } });
    }
    setOpen(false);
  }

  async function handleMarkAllRead() {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    );
    await markAllReadFn();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("relative h-8 w-8 p-0", className)}
          title="Notifications"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end" side="bottom">
        <div className="flex items-center justify-between px-1 py-1">
          <p className="text-sm font-medium">Notifications</p>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="mt-1 max-h-96 overflow-y-auto">
          {notifications.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">No notifications yet.</p>
          )}
          {notifications.map((n) => {
            const row = (
              <div
                key={n.id}
                onClick={() => handleOpen(n)}
                className={cn(
                  "flex items-start gap-2 rounded px-2 py-2 text-sm cursor-pointer",
                  n.read_at ? "hover:bg-muted/60" : "bg-primary/5 hover:bg-primary/10",
                )}
              >
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", LEVEL_DOT[n.level])} />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate", !n.read_at && "font-medium")}>{n.title}</p>
                  {n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}
                  <p className="text-[11px] text-muted-foreground">{relativeTime(n.created_at)}</p>
                </div>
              </div>
            );
            return n.link ? (
              <Link key={n.id} to={n.link} onClick={() => handleOpen(n)}>
                {row}
              </Link>
            ) : (
              row
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
