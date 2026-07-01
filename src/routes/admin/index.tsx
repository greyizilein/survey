import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getAdminMetrics } from "@/lib/admin.functions";
import { TrendingUp, Users, DollarSign, FileText, Zap } from "lucide-react";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboardPage,
});

type Metrics = Awaited<ReturnType<typeof getAdminMetrics>>;

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="border-2 border-border p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <Icon className="size-5 text-muted-foreground" />
      </div>
    </div>
  );
}

const TIER_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  max: "Max",
  enterprise: "Enterprise",
};

function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminMetrics().then(setMetrics).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading metrics…
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500 text-sm">
        Failed to load metrics.
      </div>
    );
  }

  const mrrUsd = (metrics.mrrCents / 100).toFixed(0);
  const arrUsd = ((metrics.mrrCents * 12) / 100).toFixed(0);

  return (
    <div className="p-8">
      <h1 className="text-lg font-bold uppercase tracking-widest mb-8">Overview</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-10">
        <StatCard
          label="MRR"
          value={`$${Number(mrrUsd).toLocaleString()}`}
          sub={`ARR $${Number(arrUsd).toLocaleString()}`}
          icon={DollarSign}
        />
        <StatCard
          label="Total users"
          value={metrics.totalUsers.toLocaleString()}
          sub={`+${metrics.newUsersThisMonth} this month`}
          icon={Users}
        />
        <StatCard
          label="Enterprise seats"
          value={metrics.activeEnterprise}
          sub="active members"
          icon={TrendingUp}
        />
        <StatCard
          label="Words this month"
          value={metrics.totalWordsThisMonth.toLocaleString()}
          sub="across all users"
          icon={Zap}
        />
      </div>

      {/* Users by tier */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="border-2 border-border p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Users by tier
          </p>
          <div className="space-y-3">
            {(["free", "starter", "pro", "max", "enterprise"] as const).map((tier) => {
              const count = metrics.tierCounts[tier] ?? 0;
              const total = metrics.totalUsers || 1;
              const pct = Math.round((count / total) * 100);
              return (
                <div key={tier}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{TIER_LABELS[tier]}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-none">
                    <div
                      className="h-full bg-foreground transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent payments */}
        <div className="border-2 border-border p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Recent payments
          </p>
          {metrics.recentPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment events yet.</p>
          ) : (
            <div className="space-y-2">
              {metrics.recentPayments.map((p: any, i: number) => (
                <div key={i} className="flex justify-between text-sm border-b border-border pb-2 last:border-0">
                  <span className="text-muted-foreground">
                    {p.event_type.replace("charge.", "").replace("subscription.", "")}
                  </span>
                  <span className="font-medium tabular-nums">
                    {p.currency} {p.amount_cents ? (p.amount_cents / 100).toLocaleString() : "—"}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
