import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getAdminUsers } from "@/lib/admin.functions";
import { Search } from "lucide-react";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsersPage,
});

type User = Awaited<ReturnType<typeof getAdminUsers>>[number];

const TIER_BADGE: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  starter: "bg-blue-100 text-blue-800",
  pro: "bg-purple-100 text-purple-800",
  max: "bg-orange-100 text-orange-800",
  enterprise: "bg-foreground text-background",
};

function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getAdminUsers().then(setUsers).finally(() => setLoading(false));
  }, []);

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(query.toLowerCase()) ||
      (u.display_name ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold uppercase tracking-widest">Users</h1>
        <span className="text-sm text-muted-foreground">{users.length} total</span>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by email or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border-2 border-border bg-background pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-foreground"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="border-2 border-border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.display_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-bold uppercase ${TIER_BADGE[u.subscription_type] ?? TIER_BADGE.free}`}>
                        {u.subscription_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
