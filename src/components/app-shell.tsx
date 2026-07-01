import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ClipboardPenLine,
  LogOut,
  Menu,
  MessageSquareText,
  BarChart3,
  Presentation,
  Bot,
  ClipboardCheck,
  FileCheck2,
  LayoutDashboard,
  Folder,
  Settings,
  Zap,
  Gem,
  Crown,
  CreditCard,
  Shield,
  Wand2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { clearPasskey } from "@/lib/passkey";
import { Logo } from "@/components/logo";
import { NotificationsMenu } from "@/components/notifications-menu";
import { SupervisorFeedbackModal } from "@/components/supervisor-feedback-modal";
import { useEffect, useState, type ReactNode } from "react";
import { useModelTier } from "@/lib/use-model-tier";
import { MODEL_TIER_LABELS, MODEL_TIER_DESCRIPTIONS, type ModelTier } from "@/lib/model-tier";
import { useIsAdmin } from "@/lib/use-admin";

const TIER_ICON: Record<ModelTier, typeof Zap> = { fast: Zap, pro: Gem, max: Crown };

function TierPicker({ tier, setTier }: { tier: ModelTier; setTier: (t: ModelTier) => void }) {
  return (
    <div className="px-3 py-2.5 border-b-2 border-sidebar-border">
      <div className="grid grid-cols-3 gap-1">
        {(["fast", "pro", "max"] as const).map((t) => {
          const Icon = TIER_ICON[t];
          const active = tier === t;
          return (
            <button
              key={t}
              onClick={() => setTier(t)}
              title={MODEL_TIER_DESCRIPTIONS[t]}
              className={cn(
                "flex flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold uppercase tracking-wide border-2 transition-all",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-foreground"
                  : "border-transparent text-sidebar-foreground/60 hover:border-sidebar-border hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {MODEL_TIER_LABELS[t]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const nav = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/folders", label: "Folders", icon: Folder },
  { to: "/app/fill", label: "Fill a survey", icon: ClipboardPenLine },
  { to: "/app/interviews", label: "Interview Studio", icon: MessageSquareText },
  { to: "/app/analyze", label: "Writing", icon: BarChart3 },
  { to: "/app/humanize", label: "Humanizer", icon: Wand2 },
  { action: "corrections" as const, label: "Corrections", icon: ClipboardCheck },
  { to: "/app/formatting", label: "Formatting", icon: FileCheck2 },
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
  const [tier, setTier] = useModelTier();
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const { data: isAdmin } = useIsAdmin();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
    const inactive =
      "border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground";
    const base =
      "flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-all border-2";
    return (
      <nav className="flex-1 p-3 space-y-1.5">
        {nav.map((n) => {
          if ("action" in n) {
            return (
              <button
                key={n.label}
                onClick={() => setCorrectionsOpen(true)}
                title={showLabels ? undefined : n.label}
                className={cn(base, "w-full", !showLabels && "justify-center", inactive)}
              >
                <n.icon className="size-4 shrink-0" />
                {showLabels && n.label}
              </button>
            );
          }
          const active = pathname.startsWith(n.to);
          return (
            <Link
              key={n.label}
              to={n.to}
              title={showLabels ? undefined : n.label}
              className={cn(
                base,
                !showLabels && "justify-center",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-foreground translate-x-0.5"
                  : inactive,
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

  function renderFloatingNav() {
    const base =
      "flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors";
    const inactive = "text-white/70 hover:bg-white/5 hover:text-white";
    return (
      <nav className="p-2">
        {nav.map((n) => {
          if ("action" in n) {
            return (
              <button
                key={n.label}
                onClick={() => setCorrectionsOpen(true)}
                className={cn(base, inactive)}
              >
                <n.icon className="size-4 shrink-0" />
                {n.label}
              </button>
            );
          }
          const active = pathname.startsWith(n.to);
          return (
            <Link
              key={n.label}
              to={n.to}
              className={cn(base, active ? "bg-white/10 text-white" : inactive)}
            >
              <n.icon className="size-4 shrink-0" />
              {n.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  const MobileFloatingMenu = (
    <div className="md:hidden fixed inset-0 z-50 flex items-center justify-center px-6 pointer-events-none">
      <div className="w-full max-w-xs rounded-2xl bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-2xl text-white overflow-hidden pointer-events-auto animate-in fade-in zoom-in-95 duration-150">
        <Link
          to="/"
          className="flex items-center gap-2.5 px-3 py-3 border-b border-white/10 hover:bg-white/5 transition-colors"
        >
          <Logo className="size-7 shrink-0 rotate-[-3deg]" />
          <span className="font-bold tracking-tight">Office</span>
        </Link>
        <div className="px-3 py-2.5 border-b border-white/10">
          <div className="grid grid-cols-3 gap-1">
            {(["fast", "pro", "max"] as const).map((t) => {
              const Icon = TIER_ICON[t];
              const active = tier === t;
              return (
                <button
                  key={t}
                  onClick={() => setTier(t)}
                  title={MODEL_TIER_DESCRIPTIONS[t]}
                  className={cn(
                    "flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all",
                    active ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80",
                  )}
                >
                  <Icon className="size-3.5" />
                  {MODEL_TIER_LABELS[t]}
                </button>
              );
            })}
          </div>
        </div>
        {renderFloatingNav()}
        <div className="border-t border-white/10 p-2">
          <Link
            to="/pricing"
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-white/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <CreditCard className="size-4" /> Pricing
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-white/70 hover:bg-white/5 hover:text-white transition-colors"
            >
              <Shield className="size-4" /> Admin
            </Link>
          )}
          <Link
            to="/app/settings"
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-white/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <Settings className="size-4" /> Settings
          </Link>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-white/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  const DesktopSidebarBody = (
    <>
      <div
        className={cn(
          "py-5 border-b-2 border-sidebar-border flex items-center",
          collapsed ? "justify-center px-2" : "justify-between px-5",
        )}
      >
        <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
          <Logo className="size-8 shrink-0 rotate-[-3deg]" />
          {!collapsed && (
            <span className="font-bold tracking-tight text-lg whitespace-nowrap">Office</span>
          )}
        </Link>
        {!collapsed && (
          <div className="flex items-center gap-1 shrink-0">
            <NotificationsMenu />
            <button
              onClick={toggleCollapsed}
              className="p-1.5 hover:bg-sidebar-accent/60 shrink-0"
              aria-label="Collapse menu"
              title="Collapse menu"
            >
              <Menu className="size-4" />
            </button>
          </div>
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
      {!collapsed && <TierPicker tier={tier} setTier={setTier} />}
      {renderNav(!collapsed)}
      <Link
        to="/pricing"
        title={collapsed ? "Pricing" : undefined}
        className={cn(
          "mx-3 flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-2 transition-all",
          collapsed && "justify-center",
          pathname.startsWith("/pricing")
            ? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-foreground translate-x-0.5"
            : "border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground",
        )}
      >
        <CreditCard className="size-4 shrink-0" /> {!collapsed && "Pricing"}
      </Link>
      {isAdmin && (
        <Link
          to="/admin"
          title={collapsed ? "Admin" : undefined}
          className={cn(
            "mx-3 flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-2 transition-all",
            collapsed && "justify-center",
            pathname.startsWith("/admin")
              ? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-foreground translate-x-0.5"
              : "border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground",
          )}
        >
          <Shield className="size-4 shrink-0" /> {!collapsed && "Admin"}
        </Link>
      )}
      <Link
        to="/app/settings"
        title={collapsed ? "Settings" : undefined}
        className={cn(
          "mx-3 flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-2 transition-all",
          collapsed && "justify-center",
          pathname.startsWith("/app/settings")
            ? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-foreground translate-x-0.5"
            : "border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground",
        )}
      >
        <Settings className="size-4 shrink-0" /> {!collapsed && "Settings"}
      </Link>
      <button
        onClick={signOut}
        title={collapsed ? "Sign out" : undefined}
        className={cn(
          "mx-3 mt-1 mb-3 flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-2 border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:text-sidebar-foreground transition-all",
          collapsed && "justify-center",
        )}
      >
        <LogOut className="size-4 shrink-0" /> {!collapsed && "Sign out"}
      </button>
    </>
  );

  return (
    <div className="h-dvh flex bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex border-r-2 border-sidebar-border bg-sidebar flex-col overflow-y-auto transition-[width] duration-150 animate-in fade-in slide-in-from-left-4 duration-300",
          collapsed ? "w-16" : "w-60",
        )}
      >
        {DesktopSidebarBody}
      </aside>

      {/* Mobile floating menu + click-outside overlay */}
      {open && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {MobileFloatingMenu}
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
            <Link to="/" className="flex items-center gap-2 flex-1 min-w-0">
              <Logo className="size-6 rotate-[-3deg]" />
              <span className="font-bold tracking-tight text-sm">Office</span>
            </Link>
            <NotificationsMenu />
          </header>
        )}

        <main
          className={cn(
            "flex-1 overflow-x-hidden animate-in fade-in duration-300",
            fullScreenMobile ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {typeof children === "function" ? children(() => setOpen(true)) : children}
        </main>
      </div>

      {/* Standalone corrections — works on any document, including work from off-platform */}
      <SupervisorFeedbackModal
        standalone
        open={correctionsOpen}
        onClose={() => setCorrectionsOpen(false)}
        documentText=""
        onApplied={() => {}}
      />
    </div>
  );
}
