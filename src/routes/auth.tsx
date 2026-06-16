import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  clearPasskey,
  enrollPasskey,
  getStoredPasskey,
  isPasskeySupported,
  unlockWithPasskey,
  updateStoredRefreshToken,
} from "@/lib/passkey";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in · Surveyor" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Passkey state
  const [supportsPasskey, setSupportsPasskey] = useState(false);
  const [storedEmail, setStoredEmail] = useState<string | null>(null);
  const [enrollOffer, setEnrollOffer] = useState<{
    email: string;
    userId: string;
    refreshToken: string;
  } | null>(null);

  useEffect(() => {
    isPasskeySupported().then(setSupportsPasskey);
    const stored = getStoredPasskey();
    if (stored) setStoredEmail(stored.email);
    // Keep stored refresh token fresh as Supabase rotates it.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session?.refresh_token) {
        updateStoredRefreshToken(session.refresh_token);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function maybeOfferEnrollment() {
    if (!(await isPasskeySupported())) {
      navigate({ to: "/app" });
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      navigate({ to: "/app" });
      return;
    }
    // Already enrolled for this email? skip.
    const stored = getStoredPasskey();
    if (stored && stored.email === data.session.user.email) {
      navigate({ to: "/app" });
      return;
    }
    setEnrollOffer({
      email: data.session.user.email ?? "account",
      userId: data.session.user.id,
      refreshToken: data.session.refresh_token,
    });
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin + "/app" },
        });
        if (error) throw error;
        toast.success("Account created. Check your email if confirmation is required.");
        await maybeOfferEnrollment();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await maybeOfferEnrollment();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
    } finally { setLoading(false); }
  }

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/app" });
    if (result.error) { toast.error("Google sign-in failed"); setLoading(false); return; }
    if (result.redirected) return;
    await maybeOfferEnrollment();
  }

  async function handleFingerprintSignIn() {
    setLoading(true);
    try {
      const { refreshToken } = await unlockWithPasskey();
      // Restore session using stored refresh token.
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) {
        // Stored token is stale — clear and force re-login.
        clearPasskey();
        setStoredEmail(null);
        throw new Error("Fingerprint session expired. Please sign in again.");
      }
      updateStoredRefreshToken(data.session.refresh_token);
      navigate({ to: "/app" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fingerprint sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnroll() {
    if (!enrollOffer) return;
    setLoading(true);
    try {
      await enrollPasskey(enrollOffer);
      toast.success("Fingerprint sign-in enabled on this device");
      navigate({ to: "/app" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not enable fingerprint");
      navigate({ to: "/app" });
    } finally {
      setLoading(false);
    }
  }

  function skipEnroll() {
    setEnrollOffer(null);
    navigate({ to: "/app" });
  }

  // Enrollment prompt screen
  if (enrollOffer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="mx-auto size-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Fingerprint className="size-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold mt-5">Enable fingerprint sign-in?</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Next time, sign in to <span className="font-medium text-foreground">{enrollOffer.email}</span> on this device with just your fingerprint, Face ID, or Windows Hello.
          </p>
          <div className="mt-6 space-y-2">
            <Button className="w-full" onClick={confirmEnroll} disabled={loading}>
              {loading ? "Setting up..." : "Enable fingerprint"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={skipEnroll} disabled={loading}>
              Not now
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Only stored on this device. You can remove it anytime by signing out.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Surveyor</Link>
        <h1 className="text-2xl font-semibold mt-4">{mode === "signin" ? "Sign in" : "Create account"}</h1>
        <p className="text-sm text-muted-foreground mt-1">Synthetic respondents for real research.</p>

        {supportsPasskey && storedEmail && mode === "signin" && (
          <>
            <Button
              type="button"
              className="w-full mt-6 gap-2"
              onClick={handleFingerprintSignIn}
              disabled={loading}
            >
              <Fingerprint className="size-4" />
              Sign in as {storedEmail}
            </Button>
            <button
              type="button"
              onClick={() => { clearPasskey(); setStoredEmail(null); }}
              className="text-xs text-muted-foreground hover:text-foreground mt-2 w-full"
            >
              Use a different account
            </button>
            <div className="flex items-center gap-3 my-6">
              <div className="h-px bg-border flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px bg-border flex-1" />
            </div>
          </>
        )}

        <Button type="button" variant="outline" className="w-full mt-6" onClick={handleGoogle} disabled={loading}>
          Continue with Google
        </Button>

        <div className="flex items-center gap-3 my-6">
          <div className="h-px bg-border flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px bg-border flex-1" />
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "..." : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-sm text-muted-foreground hover:text-foreground mt-4 w-full">
          {mode === "signin" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>
      </Card>
    </div>
  );
}
