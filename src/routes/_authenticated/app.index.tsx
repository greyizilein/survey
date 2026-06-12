import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Clipboard, Download, ExternalLink, Loader2, Wand2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { createFillRunFromLink, submitDirectFill } from "@/lib/fill-flow.functions";
import { autoFillForm, isAutofillServiceConfigured } from "@/lib/autofill.functions";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Fill a survey · Surveyor" }] }),
  component: Dashboard,
});

function Dashboard() {
  const fillFn = useServerFn(createFillRunFromLink);
  const directFillFn = useServerFn(submitDirectFill);
  const autoFillFn = useServerFn(autoFillForm);
  const autoFillConfiguredFn = useServerFn(isAutofillServiceConfigured);
  const autoFillConfigQ = useQuery({ queryKey: ["autofill-configured"], queryFn: () => autoFillConfiguredFn() });
  const [url, setUrl] = useState("");
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(5);
  const [responseLength, setResponseLength] = useState<"short" | "medium" | "long">("medium");
  const [variation, setVariation] = useState(50);
  const [personality, setPersonality] = useState("");
  const [loading, setLoading] = useState(false);
  const [run, setRun] = useState<any>(null);
  const [filling, setFilling] = useState(false);

  async function startFill() {
    if (!url.trim()) { toast.error("Paste a survey link first"); return; }
    setLoading(true);
    setRun(null);
    try {
      const result = await fillFn({ data: {
        survey_url: url.trim(),
        respondent_count: count,
        audience_brief: brief.trim() || undefined,
        response_length: responseLength,
        variation,
        personality: personality.trim() || undefined,
      } });
      setRun(result);
      toast.success(
        autoFillConfigQ.data?.configured || result.direct_submit
          ? "Answers generated. Click \"Submit\" to fill the form."
          : "Answers generated. Open the form to fill it in manually.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate answers");
    } finally {
      setLoading(false);
    }
  }

  function copyPayload() {
    if (!run?.primary_payload) return;
    navigator.clipboard.writeText(JSON.stringify(run.primary_payload, null, 2));
    toast.success("Response JSON copied");
  }

  function downloadPayload() {
    if (!run?.extension_payload) return;
    downloadFile(JSON.stringify(run.extension_payload, null, 2), "surveyor-fill-payload.json", "application/json");
  }

  async function autoFillAll() {
    if (!run?.responses?.length) return;
    setFilling(true);
    let submitted = 0;
    try {
      for (let i = 0; i < run.responses.length; i++) {
        const response = run.responses[i];
        try {
          if (run.direct_submit && run.form_action) {
            await directFillFn({ data: {
              form_action: run.form_action,
              page_history: run.page_history,
              answers: (response.answers ?? []).map((a: any) => ({
                question_id: String(a.question_id),
                answer: String(a.answer ?? ""),
                type: a.type ? String(a.type) : undefined,
                options: Array.isArray(a.options) ? a.options.map(String) : undefined,
              })),
            }});
            submitted++;
            toast.success(`Submitted ${submitted}/${run.responses.length}...`, { id: "fill-progress" });
            // Small human-like gap between submissions
            await new Promise((r) => setTimeout(r, 800 + Math.random() * 1500));
          } else {
            const result: any = await autoFillFn({ data: { url: run.survey_url, answers: response.answers } });
            if (result.submitted) submitted++;
            if (!result.submitted && result.debug) {
              console.log("Auto-fill debug:", result);
              toast(`Filled ${result.filled} fields, no submit found. Page: "${result.debug.title}" · ${result.debug.radiogroups} question groups, ${result.debug.textFields} text fields. Buttons: ${result.debug.buttons.join(", ") || "none"}`, { duration: 12000 });
            }
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Auto-fill failed for one respondent");
        }
      }
      toast.success(`Submitted ${submitted}/${run.responses.length} responses to the form.`, { id: "fill-progress" });
    } finally {
      setFilling(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6 max-w-3xl">
          <Badge variant="outline" className="mb-3">Core workflow</Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Paste a survey link. Generate answers. Fill the live form.</h1>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Surveyor creates realistic respondents and fills the form for you — questions, choices, and open-ended answers, written in character.
          </p>
        </div>

        <Card className="p-4 sm:p-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="survey-url">Survey link</Label>
              <Input
                id="survey-url"
                type="url"
                inputMode="url"
                placeholder="https://forms.google.com/..."
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[120px,minmax(0,1fr)]">
              <div className="space-y-2">
                <Label htmlFor="respondents">Responses</Label>
                <Input
                  id="respondents"
                  type="number"
                  min={1}
                  max={25}
                  value={count}
                  onChange={(event) => setCount(Math.max(1, Math.min(25, Number(event.target.value) || 1)))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="audience">Who should answer?</Label>
                <Textarea
                  id="audience"
                  rows={3}
                  placeholder="Example: UK university students, busy parents in Lagos, enterprise software buyers..."
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Answer length</Label>
              <div className="flex gap-2">
                {(["short", "medium", "long"] as const).map((opt) => (
                  <Button
                    key={opt}
                    type="button"
                    size="sm"
                    variant={responseLength === opt ? "default" : "outline"}
                    onClick={() => setResponseLength(opt)}
                    className="capitalize"
                  >
                    {opt}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                How detailed open-ended / interview-style answers should be.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="variation">Variation between respondents</Label>
                <span className="text-xs text-muted-foreground">{variation}%</span>
              </div>
              <Slider
                id="variation"
                min={0}
                max={100}
                step={10}
                value={[variation]}
                onValueChange={([v]) => setVariation(v)}
              />
              <p className="text-xs text-muted-foreground">
                Higher = more varied tone, phrasing, and sentence length across respondents.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="personality">Personality / voice (optional)</Label>
              <Textarea
                id="personality"
                rows={2}
                placeholder="Example: casual and a bit skeptical, formal and concise, warm and chatty..."
                value={personality}
                onChange={(event) => setPersonality(event.target.value)}
              />
            </div>

            <Button onClick={startFill} disabled={loading} size="lg" className="w-full sm:w-auto">
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Wand2 className="mr-2 size-4" />}
              {loading ? "Generating fill-ready answers..." : "Generate answers for this form"}
            </Button>
          </div>
        </Card>

        {run && (
          <Card className="mt-4 p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Ready to fill</h2>
                <p className="text-sm text-muted-foreground">{run.questions.length} questions · {run.responses.length} generated respondents</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {run.direct_submit || autoFillConfigQ.data?.configured ? (
                  <Button onClick={autoFillAll} disabled={filling}>
                    {filling ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Wand2 className="mr-2 size-4" />}
                    {filling ? "Submitting..." : `Submit ${run.responses.length} responses to the form`}
                  </Button>
                ) : (
                  <Button asChild><a href={run.survey_url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 size-4" /> Open form</a></Button>
                )}
                <Button variant="outline" onClick={copyPayload}><Clipboard className="mr-2 size-4" /> Copy first response</Button>
                <Button variant="outline" onClick={downloadPayload}><Download className="mr-2 size-4" /> Download all responses</Button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">Detected questions</h3>
                <div className="max-h-72 overflow-auto rounded-md border bg-muted/20 p-3 text-sm">
                  {run.questions.map((question: any, index: number) => (
                    <div key={question.id} className="border-b py-2 last:border-0">
                      <div className="font-medium">{index + 1}. {question.text}</div>
                      <div className="text-xs text-muted-foreground">{question.type}{question.options?.length ? ` · ${question.options.join(" / ")}` : ""}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">First response (preview)</h3>
                <pre className="max-h-72 overflow-auto rounded-md border bg-muted/20 p-3 text-xs whitespace-pre-wrap">{JSON.stringify(run.primary_payload, null, 2)}</pre>
              </div>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}