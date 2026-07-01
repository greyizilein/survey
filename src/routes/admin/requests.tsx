import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getEnterpriseRequests, updateRequestStatus } from "@/lib/admin.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/requests")({
  component: AdminRequestsPage,
});

type Request = Awaited<ReturnType<typeof getEnterpriseRequests>>[number];

const STATUS_BADGE: Record<string, string> = {
  new: "bg-yellow-100 text-yellow-800",
  reviewed: "bg-blue-100 text-blue-800",
  converted: "bg-green-100 text-green-800",
};

function AdminRequestsPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    getEnterpriseRequests().then(setRequests).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const setStatus = async (id: string, status: "new" | "reviewed" | "converted") => {
    await updateRequestStatus({ data: { id, status } });
    load();
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold uppercase tracking-widest">Enterprise requests</h1>
        <span className="text-sm text-muted-foreground">{requests.length} total</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests yet.</p>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="border-2 border-border">
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              >
                <div>
                  <p className="font-bold text-sm">{r.full_name}</p>
                  <p className="text-xs text-muted-foreground">{r.email}{r.company ? ` — ${r.company}` : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("px-2 py-0.5 text-xs font-bold uppercase", STATUS_BADGE[r.status] ?? STATUS_BADGE.new)}>
                    {r.status}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              {expanded === r.id && (
                <div className="border-t-2 border-border px-5 py-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {r.team_size && (
                      <div>
                        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Team size</span>
                        <p>{r.team_size}</p>
                      </div>
                    )}
                    {r.use_case && (
                      <div>
                        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Use case</span>
                        <p>{r.use_case}</p>
                      </div>
                    )}
                    {r.message && (
                      <div className="col-span-2">
                        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Message</span>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{r.message}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    {(["new", "reviewed", "converted"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus(r.id, s)}
                        disabled={r.status === s}
                        className={cn(
                          "border px-3 py-1 text-xs font-bold uppercase tracking-widest transition-colors",
                          r.status === s
                            ? "border-foreground bg-foreground text-background"
                            : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
