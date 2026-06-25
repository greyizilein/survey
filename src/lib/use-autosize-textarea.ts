import { useEffect, type RefObject } from "react";

/** Grows a textarea's height to fit its content, up to maxPx, as the user types. */
export function useAutosizeTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx = 160) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  }, [ref, value, maxPx]);
}
