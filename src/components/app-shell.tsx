import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Home, ClipboardPenLine, Users, FolderKanban, LogOut, Menu, X, MessageSquareText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { clearPasskey } from "@/lib/passkey";
import { useEffect, useState, type ReactNode } from "react";

const nav = [
  { to: "/app", label: "Home", icon: Home },
  { to: "/app/fill", label: "Fill a survey", icon: ClipboardPenLine },
  { to: "/app/interviews", label: "Interview Studio", icon: MessageSquareText },
  { to: "/app/personas", label: "Persona Studio", icon: Users },
  { to: "/app/projects", label: "Projects", icon: FolderKanban },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);

  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  const SidebarBody = (
    <>
      <div className="px-5 py-5 border-b-2 border-sidebar-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="size-8 bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold text-base border-2 border-sidebar-foreground rotate-[-3deg]">S</div>
          <span className="font-bold tracking-tight text-lg">Surveyor</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="md:hidden p-1.5 hover:bg-sidebar-accent/60"
          aria-label="Close menu"
        >
          <X className="size-4" />
        </button>
      </div>
      <nav className="flex-1 p-3 space-y-1.5">
        {nav.map((n) => {
          const active = n.to === "/app" ? pathname === "/app" : pathname.startsWith(n.to);
          return (
            <Link key={n.to} to={n.to} className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-all border-2",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-foreground translate-x-0.5"
                : "border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground"
            )}>
              <n.icon className="size-4" />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <button onClick={signOut} className="m-3 flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-2 border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground transition-all">
        <LogOut className="size-4" /> Sign out
      </button>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 border-r-2 border-sidebar-border bg-sidebar flex-col">
        {SidebarBody}
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
        {SidebarBody}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 border-b-2 bg-background/90 backdrop-blur px-4 h-14">
          <button
            onClick={() => setOpen(true)}
            className="p-2 -ml-2 hover:bg-accent"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="size-6 bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs border-2 border-foreground rotate-[-3deg]">S</div>
            <span className="font-bold tracking-tight text-sm">Surveyor</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
