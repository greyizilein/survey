import { useEffect, useState } from "react";
import { MODEL_TIER_COOKIE, type ModelTier } from "./model-tier";

function readTierCookie(): ModelTier {
  if (typeof document === "undefined") return "max";
  const match = document.cookie.match(new RegExp(`(?:^|; )${MODEL_TIER_COOKIE}=([^;]+)`));
  const raw = match?.[1];
  return raw === "fast" || raw === "pro" || raw === "max" ? raw : "max";
}

/** Reads/writes the global Fast/Pro/Max model tier, persisted as a cookie so server functions can read it too. */
export function useModelTier() {
  const [tier, setTierState] = useState<ModelTier>("max");

  useEffect(() => {
    setTierState(readTierCookie());
  }, []);

  function setTier(next: ModelTier) {
    document.cookie = `${MODEL_TIER_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setTierState(next);
  }

  return [tier, setTier] as const;
}
