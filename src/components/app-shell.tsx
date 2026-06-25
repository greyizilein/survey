import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ClipboardPenLine, Users, FolderKanban, LogOut, Menu, X, MessageSquareText, BarChart3, Presentation, Bot, ClipboardCheck, LayoutDashboard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { clearPasskey } from "@/lib/passkey";
import { useEffect, useState, type ReactNode } from "react";

const nav = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/fill", label: "Fill a survey", icon: ClipboardPenLine },
  { to: "/app/interviews", label: "Interview Studio", icon: MessageSquareText },
  { to: "/app/personas", label: "Persona Studio", icon: Users },
  { to: "/app/projects", label: "Projects", icon: FolderKanban },
  { to: "/app/analyze", label: "Writing", icon: BarChart3 },
  { to: "/app/analyze", search: { corrections: "1" }, label: "Corrections", icon: ClipboardCheck },
  { to: "/app/presentations", label: "Presentations", icon: Presentation },
  { to: "/app/agent", label: "Agent", icon: Bot },
] as const;

const COLLAPSE_KEY = "sidebar-collapsed";

export function AppShell({
  children,
  fullScreenMobile,
}: {
  children: ReactNode | ((openMobileMenu: () => void) => ReactNode);
  fullScreenMobile?: boolean;
}) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function signOut() {
    clearPasskey();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  function renderNav(showLabels: boolean) {
    return (
      <nav className="flex-1 p-3 space-y-1.5">
        {nav.map((n) => {
          const active = pathname.startsWith(n.to) && !("search" in n);
          return (
            <Link
              key={n.label}
              to={n.to}
              search={"search" in n ? n.search : undefined}
              title={showLabels ? undefined : n.label}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-all border-2",
                !showLabels && "justify-center",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-foreground translate-x-0.5"
                  : "border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground"
              )}
            >
              <n.icon className="size-4 shrink-0" />
              {showLabels && n.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  const MobileSidebarBody = (
    <>
      <div className="px-5 py-5 border-b-2 border-sidebar-border flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="size-8 bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold text-base border-2 border-sidebar-foreground rotate-[-3deg]">O</div>
          <span className="font-bold tracking-tight text-lg">Office</span>
        </Link>
        <button
          onClick={() => setOpen(false)}
          className="md:hidden p-1.5 hover:bg-sidebar-accent/60"
          aria-label="Close menu"
        >
          <X className="size-4" />
        </button>
      </div>
      {renderNav(true)}
      <button onClick={signOut} className="m-3 flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-2 border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground transition-all">
        <LogOut className="size-4" /> Sign out
      </button>
    </>
  );

  const DesktopSidebarBody = (
    <>
      <div className={cn("py-5 border-b-2 border-sidebar-border flex items-center", collapsed ? "justify-center px-2" : "justify-between px-5")}>
        <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
          <div className="size-8 shrink-0 bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold text-base border-2 border-sidebar-foreground rotate-[-3deg]">O</div>
          {!collapsed && <span className="font-bold tracking-tight text-lg whitespace-nowrap">Office</span>}
        </Link>
        {!collapsed && (
          <button
            onClick={toggleCollapsed}
            className="p-1.5 hover:bg-sidebar-accent/60 shrink-0"
            aria-label="Collapse menu"
            title="Collapse menu"
          >
            <Menu className="size-4" />
          </button>
        )}
      </div>
      {collapsed && (
        <button
          onClick={toggleCollapsed}
          className="mx-3 mt-3 flex items-center justify-center p-2 hover:bg-sidebar-accent/60 border-2 border-transparent hover:border-sidebar-border"
          aria-label="Expand menu"
          title="Expand menu"
        >
          <Menu className="size-4" />
        </button>
      )}
      {renderNav(!collapsed)}
      <button
        onClick={signOut}
        title={collapsed ? "Sign out" : undefined}
        className={cn(
          "m-3 flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-2 border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground transition-all",
          collapsed && "justify-center"
        )}
      >
        <LogOut className="size-4 shrink-0" /> {!collapsed && "Sign out"}
      </button>
    </>
  );

  return (
    <div className="min-h-dvh flex bg-background">
      {/* Desktop sidebar */}
      <aside className={cn("hidden md:flex border-r-2 border-sidebar-border bg-sidebar flex-col transition-[width] duration-150 animate-in fade-in slide-in-from-left-4 duration-300", collapsed ? "w-16" : "w-60")}>
        {DesktopSidebarBody}
      </aside>

      {/* Mobile drawer + overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 w-64 border-r-2 border-sidebar-border bg-sidebar flex flex-col transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {MobileSidebarBody}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        {!fullScreenMobile && (
          <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 border-b-2 bg-background/90 backdrop-blur px-4 h-14">
            <button
              onClick={() => setOpen(true)}
              className="p-2 -ml-2 hover:bg-accent"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </button>
            <Link to="/" className="flex items-center gap-2">
              <div className="size-6 bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs border-2 border-foreground rotate-[-3deg]">O</div>
              <span className="font-bold tracking-tight text-sm">Office</span>
            </Link>
          </header>
        )}

        <main className={cn("flex-1 overflow-y-auto animate-in fade-in duration-300", fullScreenMobile && "md:overflow-y-auto overflow-hidden")}>
          {typeof children === "function" ? children(() => setOpen(true)) : children}
        </main>
      </div>
    </div>
  );
}
