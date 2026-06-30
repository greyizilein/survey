"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A precision-instrument toolbar button that triggers the Smart Prompt flow.
 * Design: lime-green accent fill, hard-shadow offset, sharp corners (radius 0),
 * crosshair-pen SVG icon — no sparkles.
 */
export function SmartPromptButton({
  onClick,
  disabled,
  loading,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title="Smart Prompt — reads your documents and builds a perfect prompt"
      aria-label="Smart Prompt"
      className={cn(
        // Base layout
        "relative inline-flex h-8 items-center gap-1.5 px-2.5",
        // Typography
        "font-mono text-[11px] font-semibold tracking-widest uppercase",
        // Colours — lime accent bg, dark text
        "bg-accent text-accent-foreground",
        // Hard border
        "border border-border",
        // Hard shadow — the app's signature offset shadow
        "shadow-[3px_3px_0_0_var(--color-border)]",
        // Hover: shift into shadow like a pressed keycap
        "transition-[transform,box-shadow] duration-100 ease-in",
        "hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_0_var(--color-border)]",
        "active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
        // Disabled
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {loading ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <CrosshairPenIcon className="size-3.5 shrink-0" />
      )}
      <span className="hidden sm:inline">Smart Prompt</span>
    </button>
  );
}

/** A custom inline SVG: crosshair circle with a pen nib — no sparkles */
function CrosshairPenIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Crosshair circle */}
      <circle cx="8" cy="8" r="3.5" />
      {/* Crosshair ticks */}
      <line x1="8" y1="1" x2="8" y2="3.5" />
      <line x1="8" y1="12.5" x2="8" y2="15" />
      <line x1="1" y1="8" x2="3.5" y2="8" />
      <line x1="12.5" y1="8" x2="15" y2="8" />
      {/* Pen nib dot at center */}
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
