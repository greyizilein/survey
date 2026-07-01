import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Settings,
  Loader2,
  User,
  SlidersHorizontal,
  ShieldCheck,
  Fingerprint,
  TriangleAlert,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { clearPasskey, enrollPasskey, getStoredPasskey, isPasskeySupported } from "@/lib/passkey";
import { useModelTier } from "@/lib/use-model-tier";
import { useTheme, type Theme } from "@/lib/use-theme";
import { MODEL_TIER_LABELS, MODEL_TIER_DESCRIPTIONS, type ModelTier } from "@/lib/model-tier";
import { getProfile, updateProfile, deleteAccount } from "@/lib/settings.functions";

export const Route = createFileRoute("/_authenticated/app/settings")({
  head: () => ({ meta: [{ title: "Settings · Paperstudio" }] }),
  component: SettingsPage,
});

function initials(name: string | null, email: string | null): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function SettingsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const getProfileFn = useServerFn(getProfile);
  const updateProfileFn = useServerFn(updateProfile);
  const deleteAccountFn = useServerFn(deleteAccount);
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: () => getProfileFn() });

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <Settings className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your account, preferences, and security.
            </p>
          </div>
        </div>

        {profileQ.isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="mb-4 grid w-full grid-cols-3">
              <TabsTrigger value="profile" className="gap-1.5">
                <User className="size-4" /> Profile
              </TabsTrigger>
              <TabsTrigger value="preferences" className="gap-1.5">
                <SlidersHorizontal className="size-4" /> Preferences
              </TabsTrigger>
              <TabsTrigger value="security" className="gap-1.5">
                <ShieldCheck className="size-4" /> Security
              </TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <ProfileTab
                email={profileQ.data?.email ?? null}
                displayName={profileQ.data?.display_name ?? null}
                avatarUrl={profileQ.data?.avatar_url ?? null}
                createdAt={profileQ.data?.created_at ?? null}
                onSave={async (display_name, avatar_url) => {
                  await updateProfileFn({ data: { display_name, avatar_url } });
                  qc.invalidateQueries({ queryKey: ["profile"] });
                  qc.invalidateQueries({ queryKey: ["dashboard"] });
                }}
              />
            </TabsContent>

            <TabsContent value="preferences">
              <PreferencesTab />
            </TabsContent>

            <TabsContent value="security">
              <SecurityTab
                email={profileQ.data?.email ?? null}
                onDeleteAccount={async () => {
                  await deleteAccountFn();
                  clearPasskey();
                  await supabase.auth.signOut();
                  router.navigate({ to: "/auth", replace: true });
                }}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}

function ProfileTab({
  email,
  displayName,
  avatarUrl,
  createdAt,
  onSave,
}: {
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
  onSave: (displayName: string, avatarUrl: string) => Promise<void>;
}) {
  const [name, setName] = useState(displayName ?? "");
  const [avatar, setAvatar] = useState(avatarUrl ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = name !== (displayName ?? "") || avatar !== (avatarUrl ?? "");

  async function save() {
    setSaving(true);
    try {
      await onSave(name, avatar);
      toast.success("Profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6 space-y-5">
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          <AvatarImage src={avatar || undefined} alt={name} />
          <AvatarFallback className="text-lg">{initials(name, email)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="font-medium truncate">{name || "Unnamed"}</p>
          <p className="text-sm text-muted-foreground truncate">{email ?? "—"}</p>
          {createdAt && (
            <p className="text-xs text-muted-foreground">
              Member since {new Date(createdAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={120}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="avatar-url">Avatar URL</Label>
        <Input
          id="avatar-url"
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          placeholder="https://…"
          type="url"
          maxLength={500}
        />
        <p className="text-xs text-muted-foreground">
          Link to an image. Leave blank to use your initials.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Email</Label>
        <Input value={email ?? ""} disabled />
        <p className="text-xs text-muted-foreground">
          Email changes are managed under the Security tab.
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 className="size-4 animate-spin" />} Save changes
        </Button>
      </div>
    </Card>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; desc: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", desc: "Always light", icon: Sun },
  { value: "dark", label: "Dark", desc: "Always dark", icon: Moon },
  { value: "system", label: "System", desc: "Match your device", icon: Monitor },
];

function PreferencesTab() {
  const [tier, setTier] = useModelTier();
  const [theme, setTheme] = useTheme();

  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Appearance</h2>
          <p className="text-sm text-muted-foreground">
            Choose day or night mode, or follow your device.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border-2 p-3 text-left transition-all",
                  active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Icon className="size-4" /> {opt.label}
                </span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="font-medium">Default model tier</h2>
          <p className="text-sm text-muted-foreground">
            Sets which models the tools use by default. You can still switch it any time from the
            sidebar.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(["fast", "pro", "max"] as const).map((t) => {
            const active = tier === t;
            return (
              <button
                key={t}
                onClick={() => {
                  setTier(t);
                  toast.success(`Default set to ${MODEL_TIER_LABELS[t]}`);
                }}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border-2 p-3 text-left transition-all",
                  active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <span className="text-sm font-semibold">{MODEL_TIER_LABELS[t]}</span>
                <span className="text-xs text-muted-foreground">{MODEL_TIER_DESCRIPTIONS[t]}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function SecurityTab({
  email,
  onDeleteAccount,
}: {
  email: string | null;
  onDeleteAccount: () => Promise<void>;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Passkey
  const [supportsPasskey, setSupportsPasskey] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    isPasskeySupported().then(setSupportsPasskey);
    const stored = getStoredPasskey();
    setEnrolled(!!stored && stored.email === email);
  }, [email]);

  async function changeEmail() {
    if (!newEmail.trim()) return;
    setSavingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw error;
      toast.success("Check your inbox to confirm the new email");
      setNewEmail("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change email");
    } finally {
      setSavingEmail(false);
    }
  }

  async function changePassword() {
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated");
      setPassword("");
      setConfirm("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update password");
    } finally {
      setSavingPw(false);
    }
  }

  async function togglePasskey() {
    if (enrolled) {
      clearPasskey();
      setEnrolled(false);
      toast.success("Passkey removed from this device");
      return;
    }
    setEnrolling(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Not signed in");
      await enrollPasskey({
        email: data.session.user.email ?? "account",
        userId: data.session.user.id,
        refreshToken: data.session.refresh_token,
      });
      setEnrolled(true);
      toast.success("Passkey enrolled on this device");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not enroll passkey");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDeleteAccount();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete account");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6 space-y-4">
        <h2 className="font-medium">Change email</h2>
        <div className="space-y-2">
          <Label htmlFor="new-email">New email</Label>
          <Input
            id="new-email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={email ?? "you@example.com"}
          />
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={changeEmail}
            disabled={!newEmail.trim() || savingEmail}
          >
            {savingEmail && <Loader2 className="size-4 animate-spin" />} Send confirmation
          </Button>
        </div>
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <h2 className="font-medium">Change password</h2>
        <div className="space-y-2">
          <Label htmlFor="new-pw">New password</Label>
          <Input
            id="new-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-pw">Confirm password</Label>
          <Input
            id="confirm-pw"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={changePassword} disabled={!password || savingPw}>
            {savingPw && <Loader2 className="size-4 animate-spin" />} Update password
          </Button>
        </div>
      </Card>

      {supportsPasskey && (
        <Card className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 font-medium">
                <Fingerprint className="size-4" /> Passkey
              </h2>
              <p className="text-sm text-muted-foreground">
                {enrolled
                  ? "This device can sign in with a passkey. You can remove it below."
                  : "Enroll a passkey to sign in on this device without a password."}
              </p>
            </div>
            <Button
              variant={enrolled ? "outline" : "default"}
              onClick={togglePasskey}
              disabled={enrolling}
              className="shrink-0"
            >
              {enrolling && <Loader2 className="size-4 animate-spin" />}{" "}
              {enrolled ? "Remove" : "Enroll"}
            </Button>
          </div>
        </Card>
      )}

      <Card className="border-destructive/40 p-5 sm:p-6 space-y-3">
        <h2 className="flex items-center gap-2 font-medium text-destructive">
          <TriangleAlert className="size-4" /> Danger zone
        </h2>
        <p className="text-sm text-muted-foreground">
          Deleting your account permanently removes your profile and all your projects, surveys,
          interviews, personas, chats, and documents. This cannot be undone.
        </p>
        <div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={deleting}>
                {deleting && <Loader2 className="size-4 animate-spin" />} Delete account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes your account and every piece of data tied to it. There is
                  no recovery.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete forever
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Card>
    </div>
  );
}
