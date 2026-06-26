import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export type IngestStatus = "reading" | "ready" | "failed";

/** Tiny status pill shown on an uploaded file once it's been (or is being) ingested for context. */
export function IngestBadge({ status, className }: { status: IngestStatus; className?: string }) {
  if (status === "reading") {
    return (
      <span
        className={cn("flex shrink-0 items-center gap-1 text-xs text-muted-foreground", className)}
      >
        <Loader2 className="size-3.5 animate-spin" /> Reading…
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400",
          className,
        )}
      >
        <CheckCircle2 className="size-3.5" /> Ready
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-xs font-medium text-destructive",
        className,
      )}
    >
      <AlertTriangle className="size-3.5" /> Couldn't read
    </span>
  );
}

/** The leading file icon, colored by status (used in place of a plain FileText icon). */
export function ingestIconClass(status: IngestStatus): string {
  if (status === "ready") return "text-emerald-600 dark:text-emerald-400";
  if (status === "failed") return "text-destructive";
  return "text-muted-foreground";
}
