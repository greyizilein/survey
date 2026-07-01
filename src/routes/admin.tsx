import { createFileRoute, Outlet, Link, useLocation, redirect } from "@tanstack/react-router";
import { LayoutDashboard, Users, Building2, FileText, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Server fn to check if current user is admin
const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Primary: ADMIN_EMAIL env var (works before DB migration is run)
    const adminEmail = process.env.ADMIN_EMAIL;
    const userEmail = (context.claims as any)?.email as string | undefined;
    if (adminEmail && userEmail && userEmail === adminEmail) {
      return { isAdmin: true };
    }

    // Secondary: admin_users table (may not exist before migration)
    try {
      const { data } = await supabaseAdmin
        .from("admin_users")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle();
      return { isAdmin: !!data };
    } catch {
      return { isAdmin: false };
    }
  });

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    try {
      const result = await checkIsAdmin();
      if (!result.isAdmin) throw redirect({ to: "/" });
    } catch (e: any) {
      if (e?.isRedirect) throw e;
      throw redirect({ to: "/" });
    }
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
