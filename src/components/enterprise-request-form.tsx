import { useState } from "react";
import { X } from "lucide-react";
import { submitEnterpriseRequest } from "@/lib/admin.functions";

interface Props {
  onClose: () => void;
}

export function EnterpriseRequestForm({ onClose }: Props) {
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    company: "",
    team_size: "",
    use_case: "",
    message: "",
  });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await submitEnterpriseRequest({ data: form });
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative bg-background border-2 border-border w-full max-w-lg">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>

        <div className="px-7 py-6 border-b-2 border-border">
          <h2 className="text-sm font-bold uppercase tracking-widest">Enterprise enquiry</h2>
          <p className="mt-1 text-sm text-muted-foreground">Tell us about your team and we&apos;ll get back to you.</p>
        </div>

        {done ? (
          <div className="px-7 py-10 text-center">
            <p className="font-bold text-sm mb-2">Request received</p>
            <p className="text-sm text-muted-foreground">
              We&apos;ll be in touch at <strong>{form.email}</strong> within 24 hours.
            </p>
            <button
              onClick={onClose}
              className="mt-6 border-2 border-foreground bg-foreground px-6 py-2 text-xs font-bold uppercase tracking-widest text-background"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-7 py-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1">Full name *</label>
                <input required value={form.full_name} onChange={set("full_name")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1">Work email *</label>
                <input required type="email" value={form.email} onChange={set("email")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1">Company / Institution</label>
                <input value={form.company} onChange={set("company")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1">Team size</label>
                <select value={form.team_size} onChange={set("team_size")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground">
                  <option value="">Select…</option>
                  <option>2–5</option>
                  <option>6–15</option>
                  <option>16–50</option>
                  <option>50+</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1">Primary use case</label>
              <select value={form.use_case} onChange={set("use_case")} className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground">
                <option value="">Select…</option>
                <option>Academic research</option>
                <option>Corporate content</option>
                <option>Legal / compliance writing</option>
                <option>Journalism / media</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-1">Anything else?</label>
              <textarea value={form.message} onChange={set("message")} rows={3} placeholder="Budget, specific features, timeline…" className="w-full border-2 border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground resize-none" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={saving}
              className="w-full border-2 border-foreground bg-foreground py-3 text-xs font-bold uppercase tracking-widest text-background disabled:opacity-50"
            >
              {saving ? "Sending…" : "Send enquiry"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
