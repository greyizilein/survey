// Device-local passkey shortcut.
//
// WebAuthn (Touch ID / Windows Hello / Android fingerprint) is used purely as
// a biometric gate to release a stored Supabase refresh token on this device.
// We do NOT verify the assertion server-side — the underlying account still
// requires a real sign-in first (email/password or Google). This is the
// "device shortcut" pattern: convenience, not a new credential.

const STORE_KEY = "surveyor.passkey.v1";

type StoredPasskey = {
  credentialId: string; // base64url
  email: string;
  refreshToken: string;
  createdAt: number;
};

function b64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): ArrayBuffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function readStore(): StoredPasskey | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as StoredPasskey) : null;
  } catch {
    return null;
  }
}

function writeStore(p: StoredPasskey) {
  localStorage.setItem(STORE_KEY, JSON.stringify(p));
}

export function clearPasskey() {
  localStorage.removeItem(STORE_KEY);
}

export function getStoredPasskey(): StoredPasskey | null {
  return readStore();
}

export async function isPasskeySupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("PublicKeyCredential" in window)) return false;
  try {
    const fn = (PublicKeyCredential as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    }).isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof fn !== "function") return false;
    return await fn.call(PublicKeyCredential);
  } catch {
    return false;
  }
}

/**
 * Enroll a platform passkey for the currently signed-in user.
 * Stores the Supabase refresh token locally, gated by the passkey credential id.
 */
export async function enrollPasskey(args: {
  userId: string;
  email: string;
  refreshToken: string;
}): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(args.userId);

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Surveyor", id: window.location.hostname },
      user: {
        id: userIdBytes,
        name: args.email,
        displayName: args.email,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error("Passkey enrollment cancelled");

  writeStore({
    credentialId: b64urlEncode(cred.rawId),
    email: args.email,
    refreshToken: args.refreshToken,
    createdAt: Date.now(),
  });
}

/**
 * Prompt the platform authenticator (fingerprint / Face ID / Windows Hello)
 * and, on success, return the stored refresh token so the caller can restore
 * the Supabase session.
 */
export async function unlockWithPasskey(): Promise<{
  email: string;
  refreshToken: string;
}> {
  const stored = readStore();
  if (!stored) throw new Error("No passkey enrolled on this device");

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      timeout: 60_000,
      rpId: window.location.hostname,
      userVerification: "required",
      allowCredentials: [
        {
          type: "public-key",
          id: b64urlDecode(stored.credentialId),
          transports: ["internal"],
        },
      ],
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Fingerprint check cancelled");

  return { email: stored.email, refreshToken: stored.refreshToken };
}

/** Refresh the stored refresh token after Supabase rotates it. */
export function updateStoredRefreshToken(refreshToken: string) {
  const stored = readStore();
  if (!stored) return;
  writeStore({ ...stored, refreshToken });
}
