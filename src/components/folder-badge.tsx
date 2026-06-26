import { Link } from "@tanstack/react-router";
import { Folder } from "lucide-react";

/** Small chip shown in a tool header when the active chat belongs to a folder. Links to it. */
export function FolderBadge({ id, name }: { id: string; name: string }) {
  return (
    <Link
      to="/app/folders/$id"
      params={{ id }}
      title={`In folder: ${name}`}
      className="inline-flex max-w-[10rem] items-center gap-1.5 rounded-full border bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
    >
      <Folder className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </Link>
  );
}
