"use client";

import { useRef, useState } from "react";
import { Check, FileImage, FileText, Globe, ScanLine, Sparkles, Upload, Wand2, X } from "lucide-react";
import { useBuilder } from "@/client/builder";
import { useFactory } from "@/client/store";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Switch, Textarea } from "../ui/primitives";

const BLUEPRINT_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const EXAMPLES = [
  "Two PET bottling lines at about 12,000 bottles/h each, a shared case packer and palletizer. OPC UA on the fillers.",
  "CNC machining of brake caliper brackets: 3 robot-tended cells, in-process gauging, wash and pack-out.",
  "Industrial bakery: mixer, divider, proofer, 60 m tunnel oven, then slicing and bagging. We want to track oven zone temperatures.",
];

export function StartPanel({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  const meta = useBuilder((s) => s.meta);
  const input = useBuilder((s) => s.input);
  const setInput = useBuilder((s) => s.setInput);
  const blueprint = useBuilder((s) => s.blueprint);
  const setBlueprint = useBuilder((s) => s.setBlueprint);
  const start = useBuilder((s) => s.start);
  const busy = useBuilder((s) => s.busy.draft);
  const error = useBuilder((s) => s.error);
  const fileInput = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const ai = meta?.ai.available ?? false;

  const pick = (f: File | null) => {
    if (!f) return;
    if (!BLUEPRINT_ACCEPT.split(",").includes(f.type)) return toastError(`Unsupported file type ${f.type || "unknown"}. Use PNG, JPEG, WebP or PDF.`);
    if (f.size > 15 * 1024 * 1024) return toastError("The blueprint is larger than 15 MB.");
    setFile(f);
    setBlueprint({ url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null, fileName: f.name, mimeType: f.type });
  };
  const canStart = !!(input.requirements.trim() || file || input.templateId || input.industry.trim());

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="1. Blueprint or layout (optional)" description="A floor plan, process-flow diagram, P&ID, equipment layout, a hand sketch or a photo. PNG, JPEG, WebP or PDF up to 15 MB." icon={<FileImage className="h-4 w-4" />} />
          <CardBody>
            <input ref={fileInput} type="file" accept={BLUEPRINT_ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} data-testid="blueprint-file" />
            {file || blueprint ? (
              <div className="flex items-center gap-3 rounded-xl border border-line bg-shell p-3">
                {blueprint?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={blueprint.url} alt="Blueprint preview" className="h-20 w-28 rounded-md border border-line object-cover" />
                ) : (
                  <span className="flex h-20 w-28 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                    <FileText className="h-6 w-6" />
                  </span>
                )}
                <div className="min-w-0 flex-1 text-[12.5px]">
                  <p className="truncate font-medium text-ink">{file?.name ?? blueprint?.fileName}</p>
                  <p className="text-muted">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "Choose the file again to re-read it (files are not stored)."}</p>
                  {!ai && <p className="mt-1 text-warning-ink">Reading drawings needs an AI model, which is off or not configured here.</p>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove blueprint"
                  onClick={() => {
                    setFile(null);
                    setBlueprint(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <button
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => (e.preventDefault(), setDrag(true))}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  pick(e.dataTransfer.files?.[0] ?? null);
                }}
                className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors", drag ? "border-accent bg-accent/8" : "border-line-strong hover:bg-surface-2")}
              >
                <Upload className="h-5 w-5 text-muted" />
                <span className="text-[13px] font-medium text-ink">Drop a drawing here or choose a file</span>
                <span className="text-[11.5px] text-muted">The agent recognises machines, lines and material flow, and marks each one on the drawing for you to check.</span>
              </button>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="2. What do you want to twin?" description="Products, rates, lines, machines, what you want to monitor, and the systems you'd like to connect. Plain language is fine." icon={<Sparkles className="h-4 w-4" />} />
          <CardBody className="space-y-2">
            <Textarea
              rows={5}
              value={input.requirements}
              onChange={(e) => setInput({ requirements: e.target.value })}
              placeholder="e.g. Two PET bottling lines at 12,000 bottles/h, shared case packer and palletizer, OPC UA on the fillers…"
              aria-label="Requirements"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => setInput({ requirements: ex })} className="rounded-full border border-line px-2.5 py-1 text-left text-[11.5px] text-ink-2 hover:border-accent/50 hover:text-ink">
                  {ex.slice(0, 58)}…
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="3. About the site" description="Optional. The agent fills in what it can from the drawing and your description." />
          <CardBody className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="b-name">Factory name</Label>
              <Input id="b-name" value={input.name} onChange={(e) => setInput({ name: e.target.value })} placeholder="Riverside Plant 1" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-ind">Industry</Label>
              <Input id="b-ind" value={input.industry} onChange={(e) => setInput({ industry: e.target.value })} placeholder="Beverage" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-loc">Location</Label>
              <Input id="b-loc" value={input.location} onChange={(e) => setInput({ location: e.target.value })} placeholder="Pune, India" />
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Start from a standard layout (optional)" description="Typical configurations to edit. With AI on, the agent adapts the template to your drawing and requirements." />
          <CardBody className="grid gap-2">
            {(meta?.templates ?? []).map((t) => {
              const on = input.templateId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setInput({ templateId: on ? null : t.id, industry: input.industry || t.industry })}
                  aria-pressed={on}
                  className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition-colors", on ? "border-accent/60 bg-accent/10" : "border-line hover:bg-surface-2")}
                >
                  <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", on ? "border-accent bg-accent text-white" : "border-line-strong")}>{on && <Check className="h-3 w-3" />}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{t.name}</span>
                    <span className="block text-[11.5px] leading-snug text-muted">{t.description}</span>
                  </span>
                </button>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <Globe className="h-4 w-4 text-accent" /> Research standard layouts on the web
                </p>
                <p className="text-[11.5px] leading-snug text-muted">Web search through the AI provider (Gemini, Claude or OpenAI). Every value it uses from the web is cited.</p>
              </div>
              <Switch checked={input.research && ai} disabled={!ai} onCheckedChange={(v) => setInput({ research: v })} aria-label="Research on the web" />
            </div>
            <Button className="w-full" size="lg" variant="primary" loading={busy} disabled={!canStart || !meta} onClick={() => start(file)} data-testid="builder-start">
              {ai ? <ScanLine className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />} {ai ? "Draft my twin with the agent" : "Draft from template"}
            </Button>
            <p className="text-[11.5px] leading-relaxed text-muted">
              {ai ? (
                <>
                  The agent reads your drawing, researches the industry, and proposes lines, machines, products and data connections. Nothing is built until you review it. It uses{" "}
                  <span className="font-mono">{meta?.ai.model}</span>.
                </>
              ) : (
                <>
                  <Badge tone="warning" className="mr-1">AI off</Badge>
                  AI is turned off, so drawings can&apos;t be read and your description is matched to the closest template (robots included). You can still edit everything before building.
                </>
              )}
            </p>
            {error && <p className="rounded-lg border border-critical/40 bg-critical/8 p-2 text-[12px] text-critical-ink">{error}</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function toastError(msg: string) {
  useFactory.getState().toast({ tone: "error", title: msg });
}
