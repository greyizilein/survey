import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Chrome } from "lucide-react";

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
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">Auto-fill Google Forms, Microsoft Forms, Typeform, and similar tools.</p>

        <Card className="mt-6 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center"><Chrome className="size-6 text-primary" /></div>
            <div className="flex-1">
              <h2 className="font-semibold">Surveyor Filler</h2>
              <p className="text-sm text-muted-foreground mt-1">Loads a JSON response file you exported from Surveyor and types each answer into the live form, with randomized human delays.</p>
              <Button className="mt-4 w-full sm:w-auto" onClick={download}><Download className="size-4 mr-2" /> Download .zip</Button>
            </div>
          </div>
        </Card>

        <Card className="mt-4 p-4 sm:p-6">
          <h3 className="font-semibold mb-3">Install</h3>
          <ol className="text-sm space-y-2 text-muted-foreground list-decimal pl-5">
            <li>Unzip the downloaded file.</li>
            <li>Open <code className="text-foreground bg-muted px-1.5 py-0.5 rounded text-xs">chrome://extensions</code> in Chrome, Edge, Brave, or Arc.</li>
            <li>Toggle <strong className="text-foreground">Developer mode</strong> on (top-right).</li>
            <li>Click <strong className="text-foreground">Load unpacked</strong> and pick the unzipped folder.</li>
            <li>Open the target form, click the Surveyor icon, paste a response JSON, and hit Fill.</li>
          </ol>
        </Card>
      </div>
    </AppShell>
  );
}
