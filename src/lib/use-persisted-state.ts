import { useEffect, useRef, useState } from "react";

// useState that survives route changes (and reloads) by mirroring to
// sessionStorage. Used for in-progress form drafts so navigating to another
// tab and back doesn't wipe what the user typed or the results they generated.
export function usePersistedState<T>(key: string, initial: T) {
  const storageKey = `surveyor:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const keyRef = useRef(storageKey);
  keyRef.current = storageKey;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(keyRef.current, JSON.stringify(value));
    } catch {
      // Ignore quota / serialization errors — persistence is best-effort.
    }
  }, [value]);

  return [value, setValue] as const;
}
