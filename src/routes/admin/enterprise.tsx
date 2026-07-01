import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getEnterprises,
  createEnterprise,
  updateEnterprise,
  addEnterpriseMember,
  removeEnterpriseMember,
  sendEnterprisePaymentEmail,
  activateEnterpriseMember,
} from "@/lib/admin.functions";
import { Plus, ChevronDown, ChevronUp, Trash2, Mail, CheckCircle, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/enterprise")({
  component: AdminEnterprisePage,
});

type Enterprise = Awaited<ReturnType<typeof getEnterprises>>[number];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  emailed: "bg-blue-100 text-blue-800",
  active: "bg-green-100 text-green-800",
  inactive: "bg-muted text-muted-foreground",
};

// ── New enterprise form ──────────────────────────────────────────────────────
function EnterpriseForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Enterprise>;
  onSave: (d: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    contact_email: initial?.contact_email ?? "",
    contact_name: initial?.contact_name ?? "",
    word_allocation: initial?.word_allocation ?? 100000,
    price_usd_cents: initial?.price_usd_cents ?? 0,
    billing_interval: (initial?.billing_interval ?? "month") as "month" | "year",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const val = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((f) => ({ ...f, [k]: val }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (err: any) {
      setError(err.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  };

  const priceUsd = form.price_usd_cents / 100;

  return (
    <form onSubmit={handleSubmit} className="border-2 border-border p-6 space-y-4 bg-muted/20">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1">Company name *</label>
          <input required value={form.name} onChange={set("name")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground" />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1">Contact email *</label>
          <input required type="email" value={form.contact_email} onChange={set("contact_email")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground" />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1">Contact name</label>
          <input value={form.contact_name} onChange={set("contact_name")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground" />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1">Monthly words</label>
          <input required type="number" min={1000} step={1000} value={form.word_allocation} onChange={set("word_allocation")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground" />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1">Price (USD cents)</label>
          <input required type="number" min={0} step={100} value={form.price_usd_cents} onChange={set("price_usd_cents")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground" />
          <p className="text-xs text-muted-foreground mt-1">${priceUsd.toFixed(2)} / {form.billing_interval}</p>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-1">Billing interval</label>
          <select value={form.billing_interval} onChange={set("billing_interval")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground">
            <option value="month">Monthly</option>
            <option value="year">Annual</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest mb-1">Notes</label>
        <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground resize-none" />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="border-2 border-foreground bg-foreground px-5 py-2 text-xs font-bold uppercase tracking-widest text-background disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="border-2 border-border px-5 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Add member form ──────────────────────────────────────────────────────────
function AddMemberForm({
  enterpriseId,
  onAdded,
}: {
  enterpriseId: string;
  onAdded: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [wordOverride, setWordOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await addEnterpriseMember({
        data: {
          enterprise_id: enterpriseId,
          email,
          full_name: fullName || undefined,
          word_allocation: wordOverride ? parseInt(wordOverride, 10) : undefined,
        },
      });
      setEmail("");
      setFullName("");
      setWordOverride("");
      onAdded();
    } catch (err: any) {
      setError(err.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end pt-3 border-t border-border">
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest mb-1">Email *</label>
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" className="border-2 border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-foreground w-48" />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest mb-1">Full name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" className="border-2 border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-foreground w-36" />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest mb-1">Word override</label>
        <input type="number" value={wordOverride} onChange={(e) => setWordOverride(e.target.value)} placeholder="inherit" className="border-2 border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-foreground w-28" />
      </div>
      {error && <p className="text-xs text-red-500 w-full">{error}</p>}
      <button type="submit" disabled={saving} className="border-2 border-foreground bg-foreground px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-background disabled:opacity-50 flex items-center gap-1.5">
        <Plus className="size-3" />
        {saving ? "Adding…" : "Add member"}
      </button>
    </form>
  );
}

// ── Enterprise row ───────────────────────────────────────────────────────────
function EnterpriseRow({ enterprise, onRefresh }: { enterprise: Enterprise; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const members: any[] = (enterprise as any).enterprise_members ?? [];

  const handleSendEmail = async (memberId: string) => {
    setActionLoading(memberId + "-email");
    try {
      await sendEnterprisePaymentEmail({ data: { member_id: memberId } });
      onRefresh();
    } catch (err: any) {
      alert(err.message ?? "Failed to send email");
    } finally {
      setActionLoading(null);
    }
  };

  const handleActivate = async (memberId: string) => {
    if (!confirm("Activate this member? This will create their account and send them a sign-in email.")) return;
    setActionLoading(memberId + "-activate");
    try {
      await activateEnterpriseMember({ data: { member_id: memberId } });
      onRefresh();
    } catch (err: any) {
      alert(err.message ?? "Failed to activate");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm("Remove this member?")) return;
    await removeEnterpriseMember({ data: { member_id: memberId } });
    onRefresh();
  };

  return (
    <div className="border-2 border-border">
      {/* Header row */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-4 min-w-0">
          <div>
            <p className="font-bold text-sm">{enterprise.name}</p>
            <p className="text-xs text-muted-foreground">{enterprise.contact_email}</p>
          </div>
          <span className={cn("px-2 py-0.5 text-xs font-bold uppercase", STATUS_BADGE[enterprise.status] ?? STATUS_BADGE.pending)}>
            {enterprise.status}
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <span className="tabular-nums">{(enterprise.word_allocation ?? 0).toLocaleString()} words/mo</span>
          <span className="font-bold text-foreground">${((enterprise.price_usd_cents ?? 0) / 100).toFixed(0)}/{enterprise.billing_interval}</span>
          <span className="text-xs">{members.length} member{members.length !== 1 ? "s" : ""}</span>
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </div>
      </div>

      {/* Expanded */}
      {open && (
        <div className="border-t-2 border-border px-5 py-4 space-y-4">
          {/* Edit form */}
          {editing ? (
            <EnterpriseForm
              initial={enterprise}
              onSave={async (d) => {
                await updateEnterprise({ data: { ...d, id: enterprise.id } });
                setEditing(false);
                onRefresh();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:border-foreground transition-colors"
              >
                <Pencil className="size-3" /> Edit
              </button>
            </div>
          )}

          {/* Notes */}
          {enterprise.notes && (
            <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-3">{enterprise.notes}</p>
          )}

          {/* Members table */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Members</p>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            ) : (
              <div className="border border-border overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">Email</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">Words</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 font-mono text-xs">{m.email}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{m.full_name ?? "—"}</td>
                        <td className="px-4 py-2.5 tabular-nums text-xs">
                          {(m.word_allocation ?? enterprise.word_allocation).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={cn("px-2 py-0.5 text-xs font-bold uppercase", STATUS_BADGE[m.status] ?? STATUS_BADGE.pending)}>
                            {m.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {/* Send payment email */}
                            {m.status !== "active" && (
                              <button
                                onClick={() => handleSendEmail(m.id)}
                                disabled={actionLoading === m.id + "-email"}
                                title="Send payment email"
                                className="flex items-center gap-1 border border-blue-300 text-blue-700 px-2 py-1 text-xs font-bold uppercase hover:bg-blue-50 disabled:opacity-50 transition-colors"
                              >
                                <Mail className="size-3" />
                                {actionLoading === m.id + "-email" ? "Sending…" : "Send email"}
                              </button>
                            )}
                            {/* Activate */}
                            {m.status === "emailed" && (
                              <button
                                onClick={() => handleActivate(m.id)}
                                disabled={actionLoading === m.id + "-activate"}
                                title="Activate member"
                                className="flex items-center gap-1 border border-green-400 text-green-700 px-2 py-1 text-xs font-bold uppercase hover:bg-green-50 disabled:opacity-50 transition-colors"
                              >
                                <CheckCircle className="size-3" />
                                {actionLoading === m.id + "-activate" ? "Activating…" : "Activate"}
                              </button>
                            )}
                            {/* Remove */}
                            <button
                              onClick={() => handleRemoveMember(m.id)}
                              title="Remove member"
                              className="text-red-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <AddMemberForm enterpriseId={enterprise.id} onAdded={onRefresh} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
function AdminEnterprisePage() {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);

  const refresh = () => {
    setLoading(true);
    getEnterprises().then(setEnterprises).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold uppercase tracking-widest">Enterprise accounts</h1>
        <button
          onClick={() => setShowNewForm((s) => !s)}
          className="flex items-center gap-2 border-2 border-foreground bg-foreground px-4 py-2 text-xs font-bold uppercase tracking-widest text-background hover:opacity-90 transition-opacity"
        >
          {showNewForm ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {showNewForm ? "Cancel" : "New enterprise"}
        </button>
      </div>

      {showNewForm && (
        <div className="mb-6">
          <EnterpriseForm
            onSave={async (d) => {
              await createEnterprise({ data: d });
              setShowNewForm(false);
              refresh();
            }}
            onCancel={() => setShowNewForm(false)}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : enterprises.length === 0 ? (
        <p className="text-sm text-muted-foreground">No enterprise accounts yet.</p>
      ) : (
        <div className="space-y-3">
          {enterprises.map((e) => (
            <EnterpriseRow key={e.id} enterprise={e} onRefresh={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
