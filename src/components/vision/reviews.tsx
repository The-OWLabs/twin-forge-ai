"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileVideo, ScanSearch, Sparkles, Upload, X } from "lucide-react";
import { useFactory } from "@/client/store";
import type { FactoryState, VisionFinding, VisionReview } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtSimTime } from "@/lib/format";
import { Badge, Button, EmptyState, Input, Label, Select } from "../ui/primitives";

const SEVERITY_TONE: Record<VisionFinding["severity"], "neutral" | "warning" | "critical" | "accent"> = { info: "accent", minor: "neutral", major: "warning", critical: "critical" };
const ACCEPT = "video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp";

type GeminiStatus = { state: string; detail: string } | null;

/** Reads the honest integration status so the uploader never pretends Gemini is available. */
function useGeminiStatus(): GeminiStatus {
  const [s, setS] = useState<GeminiStatus>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { integrations: { id: string; state: string; detail: string }[] }) => {
        const v = d.integrations.find((i) => i.id === "vertex-ai");
        if (alive) setS(v ? { state: v.state, detail: v.detail } : { state: "not-configured", detail: "" });
      })
      .catch(() => alive && setS({ state: "error", detail: "Could not read integration status." }));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

export function ReviewTools({ state }: { state: FactoryState }) {
  const analyze = useFactory((s) => s.analyzeMedia);
  const reviewLog = useFactory((s) => s.reviewInspectionLog);
  const busyAnalyze = useFactory((s) => s.busy.visionAnalyze);
  const busyLog = useFactory((s) => s.busy.visionReview);
  const gemini = useGeminiStatus();
  const inspection = state.cameras.filter((c) => c.kind === "inspection");
  const [cameraId, setCameraId] = useState(inspection[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const available = gemini && gemini.state !== "not-configured";
  const tooBig = !!file && file.size > 15 * 1024 * 1024;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-line bg-shell p-3.5">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <ScanSearch className="h-4 w-4 text-accent" /> Review an inspection station&apos;s log
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Replays the last 60 units the selected station inspected and lists every reject with its acceptance criterion. Results are deterministic and come from the plant model.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="log-cam">Station</Label>
            <Select id="log-cam" className="w-full" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
              {inspection.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.zone}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" variant="secondary" loading={busyLog} disabled={!cameraId} onClick={() => void reviewLog(cameraId)}>
            Review last 60 units
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-shell p-3.5">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Sparkles className="h-4 w-4 text-agent" /> Review footage with Gemini
          <Badge tone={gemini?.state === "connected" ? "healthy" : gemini?.state === "not-configured" ? "neutral" : gemini?.state === "error" ? "critical" : "accent"} className="ml-auto">
            {gemini === null ? "checking…" : gemini.state === "not-configured" ? "not configured" : gemini.state.replace(/-/g, " ")}
          </Badge>
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Upload a short clip or photo (MP4, WebM, MOV, JPEG, PNG, WebP; up to 15 MB). Gemini reports what it can see using fixed defect categories. Results are advisory and wait for your decision.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="vision-file" />
          <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={!available}>
            <Upload className="h-3.5 w-3.5" /> {file ? "Change file" : "Choose file"}
          </Button>
          <Select aria-label="Station for uploaded footage" className="min-w-0 flex-1" value={cameraId} onChange={(e) => setCameraId(e.target.value)} disabled={!available}>
            {state.cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.zone}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="agent"
            loading={busyAnalyze}
            disabled={!available || !file || tooBig}
            onClick={async () => {
              if (!file) return;
              const r = await analyze(file, cameraId || null);
              if (r) {
                setFile(null);
                if (input.current) input.current.value = "";
              }
            }}
          >
            Analyze
          </Button>
        </div>
        {file && (
          <p className={cn("mt-2 flex items-center gap-1.5 text-[11.5px]", tooBig ? "text-critical-ink" : "text-ink-2")}>
            <FileVideo className="h-3.5 w-3.5" /> {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB{tooBig ? " — over the 15 MB limit" : ""}
          </p>
        )}
        {gemini?.state === "not-configured" && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-warning-ink">
            Gemini isn&apos;t configured on this deployment, so uploads are off. Set GOOGLE_CLOUD_PROJECT (Vertex AI) or GEMINI_API_KEY to turn them on. The station-log review still works.
          </p>
        )}
      </div>
    </div>
  );
}

export function ReviewList({ state }: { state: FactoryState }) {
  const reviews = state.visionReviews;
  if (!reviews.length) {
    return (
      <EmptyState
        icon={<ScanSearch className="h-5 w-5" />}
        title="No visual reviews yet"
        description="Review a station's inspection log or upload footage. Every review waits for a person to confirm or dismiss it."
      />
    );
  }
  return (
    <div className="space-y-3">
      {reviews.map((r) => (
        <ReviewCard key={r.id} state={state} review={r} />
      ))}
    </div>
  );
}

function ReviewCard({ state, review }: { state: FactoryState; review: VisionReview }) {
  const decide = useFactory((s) => s.dispositionReview);
  const busy = useFactory((s) => s.busy.visionDisposition);
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(review.disposition === "pending-human-review");
  const pending = review.disposition === "pending-human-review";
  const real = review.findings.filter((f) => f.category !== "No defect visible");
  const shown = expanded ? review.findings : review.findings.slice(0, 3);
  return (
    <div className={cn("rounded-xl border bg-surface p-3.5", pending ? "border-warning/40" : "border-line")} data-testid="vision-review">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-ink">{review.id}</span>
        <Badge tone={review.source === "gemini" ? "agent" : "neutral"}>{review.source === "gemini" ? `Gemini · ${review.model ?? "model"}` : "Simulated inspection log"}</Badge>
        {review.cameraId && <Badge tone="accent">{review.cameraId}</Badge>}
        <span className="text-[11.5px] text-muted">{fmtSimTime(state, review.hour)}</span>
        <Badge tone={pending ? "warning" : review.disposition === "confirmed" ? "healthy" : "neutral"} className="ml-auto">
          {pending ? "Awaiting human review" : review.disposition}
        </Badge>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{review.summary}</p>
      {review.fileName && <p className="mt-1 text-[11px] text-muted">File: {review.fileName}</p>}
      {review.findings.length > 0 && (
        <div className="mt-2.5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] tracking-wide text-muted uppercase">
                <th className="py-1.5 pr-3 font-medium">{review.source === "gemini" ? "Time" : "Offset"}</th>
                <th className="py-1.5 pr-3 font-medium">Category</th>
                <th className="py-1.5 pr-3 font-medium">Detail</th>
                <th className="py-1.5 pr-3 font-medium">Severity</th>
                <th className="py-1.5 text-right font-medium">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="tabular py-1.5 pr-3 text-muted">{f.timestampSec === null ? "—" : `${Math.floor(f.timestampSec / 60)}:${String(Math.round(f.timestampSec % 60)).padStart(2, "0")}`}</td>
                  <td className="py-1.5 pr-3 text-ink">{f.category}</td>
                  <td className="py-1.5 pr-3 text-ink-2">{f.description}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                  </td>
                  <td className="tabular py-1.5 text-right text-ink-2">{review.source === "gemini" ? `${Math.round(f.confidence * 100)}%` : "logged"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {review.findings.length > 3 && (
            <button className="mt-1 text-[11.5px] text-accent-ink hover:underline" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show fewer" : `Show all ${review.findings.length} findings`}
            </button>
          )}
        </div>
      )}
      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input className="h-8 min-w-0 flex-1 text-[12.5px]" placeholder="Note (optional), e.g. 'Confirmed at rework bench'" value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Note for ${review.id}`} />
          <Button size="sm" variant="success" loading={busy} onClick={() => void decide(review.id, "confirmed", note)}>
            <Check className="h-3.5 w-3.5" /> Confirm {real.length ? `${real.length} finding${real.length > 1 ? "s" : ""}` : ""}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(review.id, "dismissed", note)}>
            <X className="h-3.5 w-3.5" /> Dismiss
          </Button>
        </div>
      ) : (
        review.note && <p className="mt-2 text-[11.5px] text-muted">Note: “{review.note}”</p>
      )}
    </div>
  );
}
