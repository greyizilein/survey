import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clipboard, Download, Chrome } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/extension")({
  head: () => ({ meta: [{ title: "Extension · Surveyor" }] }),
  component: ExtensionPage,
});

function ExtensionPage() {
  function download() {
    fetch("/surveyor-extension.zip")
      .then((r) => { if (!r.ok) throw new Error("Download failed"); return r.blob(); })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "surveyor-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => alert(e.message));
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">Browser extension</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">This is the part that types Surveyor's generated answers into the real survey page.</p>

        <Card className="mt-6 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center"><Chrome className="size-6 text-primary" /></div>
            <div className="flex-1">
              <h2 className="font-semibold">Surveyor Filler</h2>
              <p className="text-sm text-muted-foreground mt-1">Once installed, clicking "Auto-fill" on a response in a project opens the real form and the extension fills text boxes, picks radio/checkbox/Likert options, navigates multi-page forms, and submits — all with randomized human delays. No copy-paste needed.</p>
              <Button className="mt-4 w-full sm:w-auto" onClick={download}><Download className="size-4 mr-2" /> Download .zip</Button>
            </div>
          </div>
        </Card>

        <Card className="mt-4 p-4 sm:p-6">
          <h3 className="font-semibold mb-3">Daily workflow</h3>
          <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="rounded-md border p-3"><Clipboard className="mb-2 size-4 text-primary" />Paste a form link in Surveyor and generate answers.</div>
            <div className="rounded-md border p-3"><ArrowRight className="mb-2 size-4 text-primary" />Click "Auto-fill" on any response.</div>
            <div className="rounded-md border p-3"><Chrome className="mb-2 size-4 text-primary" />The form opens and fills + submits itself.</div>
          </div>
        </Card>

        <Card className="mt-4 p-4 sm:p-6">
          <h3 className="font-semibold mb-3">Install</h3>
          <ol className="text-sm space-y-2 text-muted-foreground list-decimal pl-5">
            <li>Unzip the downloaded file.</li>
            <li>Open <code className="text-foreground bg-muted px-1.5 py-0.5 rounded text-xs">chrome://extensions</code> in Chrome, Edge, Brave, or Arc.</li>
            <li>Toggle <strong className="text-foreground">Developer mode</strong> on (top-right).</li>
            <li>Click <strong className="text-foreground">Load unpacked</strong> and pick the unzipped folder.</li>
            <li>Refresh any open Surveyor tabs, then click "Auto-fill" on a response — the form opens and fills itself.</li>
            <li>(Optional manual mode: open the target form, click the Surveyor icon, paste a response JSON, and hit Fill.)</li>
          </ol>
        </Card>
      </div>
    </AppShell>
  );
}
