import { createFileRoute, Outlet, Link, useLocation, redirect } from "@tanstack/react-router";
import { LayoutDashboard, Users, Building2, FileText, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) throw redirect({ to: "/auth" });
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/app/dashboard" });
  },
  component: AdminLayout,
});

const NAV = [
  { to: "/admin/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/enterprise", label: "Enterprise", icon: Building2 },
  { to: "/admin/requests", label: "Requests", icon: FileText },
];

function AdminLayout() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r-2 border-border flex flex-col">
        <div className="flex items-center gap-2 border-b-2 border-border px-5 py-4">
          <span className="text-xs font-bold uppercase tracking-widest">Admin</span>
        </div>
        <nav className="flex-1 py-4">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 px-5 py-2.5 text-sm font-medium transition-colors",
                location.pathname === to || location.pathname.startsWith(to.replace("/", ""))
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t-2 border-border p-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="size-3" />
            Back to app
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
