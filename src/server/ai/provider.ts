import "server-only";
import { aiCapabilities, aiConfig, modelLabel, recordAiError, type AiConfig } from "./config";
import { AiUnsupported, errorMessage, llmGenerate } from "./llm";
import { z } from "zod";
import { deterministicNarrative, type NarrativeInput } from "@/domain/narrative";
import type { Narrative } from "@/domain/types";

/**
 * AI provider abstraction for agent narratives.
 *
 * Gemini interprets and explains — it never produces the underlying numbers. Every figure
 * comes from the simulation engine; the LLM output is schema-validated and passed through a
 * numeric grounding check. Any failure falls back to the deterministic narrative.
 */

export { aiConfig, aiRuntime, resetAiRuntime, aiCapabilities, modelLabel, type AiConfig } from "./config";

const NarrativeSchema = z.object({
  summary: z.string().min(20).max(900),
  rationale: z.string().min(20).max(1400),
  risks: z.array(z.string().min(5).max(300)).min(1).max(5),
  operatorBriefing: z.string().min(10).max(600),
});

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sentence executive summary of the incident and the recommended plan." },
    rationale: { type: "string", description: "Why the recommended plan beats the alternatives, citing the provided metrics only." },
    risks: { type: "array", items: { type: "string" }, description: "1-5 key residual risks." },
    operatorBriefing: { type: "string", description: "One short paragraph addressed to the shift lead." },
  },
  required: ["summary", "rationale", "risks", "operatorBriefing"],
};

function buildPrompt(input: NarrativeInput) {
  return [
    "You are the Operations Orchestrator of an industrial digital-twin platform.",
    "Write a concise operational briefing for plant management based ONLY on the JSON facts below.",
    "Rules:",
    "- Do not invent numbers. Every number you mention must appear verbatim (or rounded) in the facts.",
    "- Simulation outputs are model estimates from demo data; describe them as estimates, not guarantees.",
    "- Never suggest bypassing safety interlocks or directly commanding machinery; actions require human approval.",
    "- Hours are relative to now (h+N).",
    "",
    "FACTS:",
    JSON.stringify(input),
  ].join("\n");
}

/** Collect every number that appears in the structured input (various roundings). */
function groundedNumbers(input: NarrativeInput) {
  const set = new Set<string>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    for (const v of [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100, Math.round(n * 100), Math.abs(n)]) set.add(String(v));
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") (v.match(/-?\d[\d,]*\.?\d*/g) ?? []).forEach((m) => add(Number(m.replace(/,/g, ""))));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(input);
  return set;
}

export function ungroundedFigures(text: string, input: NarrativeInput) {
  const allowed = groundedNumbers(input);
  const found = (text.match(/\d[\d,]*\.?\d*/g) ?? []).map((m) => m.replace(/,/g, "").replace(/\.$/, ""));
  return found.filter((f) => {
    const n = Number(f);
    if (!Number.isFinite(n) || n < 10) return false; // small counts / ordinals are not checked
    return !allowed.has(String(n)) && !allowed.has(String(Math.round(n)));
  });
}

async function callModel(input: NarrativeInput): Promise<Narrative> {
  const r = await llmGenerate({
    prompt: buildPrompt(input),
    json: { name: "operations_briefing", schema: RESPONSE_JSON_SCHEMA },
    temperature: 0.2,
    // Thinking tokens count toward the output limit on Gemini 3.x, so leave headroom.
    maxOutputTokens: 4096,
    // A briefing written from fixed facts needs little reasoning; low thinking keeps it fast.
    thinkingLow: true,
  });
  const parsed = NarrativeSchema.parse(r.json);
  const all = [parsed.summary, parsed.rationale, parsed.operatorBriefing, ...parsed.risks].join(" ");
  const bad = ungroundedFigures(all, input);
  if (bad.length) throw new Error(`grounding check failed — figure(s) ${bad.slice(0, 3).join(", ")} not found in simulation outputs`);
  return { source: "gemini", model: r.model, ...parsed, note: `Schema-validated; all figures traced to simulation outputs. ${r.latencyMs} ms.` };
}

export async function generateNarrative(input: NarrativeInput): Promise<Narrative> {
  const cfg = aiConfig();
  if (cfg.provider === "none") {
    return deterministicNarrative(input, `${cfg.disabled ? "AI is turned off" : "No AI provider is configured"} — deterministic narrative generated from simulation outputs.`);
  }
  try {
    return await callModel(input);
  } catch (e) {
    const msg = errorMessage(e);
    if (/grounding check failed/.test(msg)) recordAiError(msg);
    return deterministicNarrative(input, `${modelLabel(cfg)} call failed (${msg.slice(0, 160)}); fell back to deterministic narrative.`);
  }
}

/** Minimal connectivity probe used by the Integrations page. */
export async function testAi(): Promise<{ ok: boolean; detail: string }> {
  const cfg = aiConfig();
  if (cfg.provider === "none") return { ok: false, detail: `Not configured: ${cfg.missing.join("; ")}` };
  const sample: NarrativeInput = {
    factory: "Connectivity test",
    asset: { id: "TEST-01", name: "Test asset", failureMode: null },
    incident: null,
    agentSummaries: [],
    scenarios: [{ id: "continue", name: "Continue", score: 50, lateUnits: 120, ordersLate: 1, operatingCost: 1500, failureHour: 12, unplannedDowntime: 16, feasible: true }],
    recommended: { id: "continue", name: "Continue", explanation: ["Test only."], risks: ["Test risk."], benefits: [] },
    conflicts: [],
  };
  const started = Date.now();
  try {
    const n = await callModel(sample);
    return { ok: true, detail: `${n.model} responded (${Date.now() - started} ms).` };
  } catch (e) {
    const msg = errorMessage(e);
    recordAiError(msg);
    return { ok: false, detail: msg.slice(0, 300) };
  }
}

/* ───────────────────────────── Visual review (video / image) ───────────────────────────── */

export const MEDIA_LIMIT_BYTES = 15 * 1024 * 1024;
export const MEDIA_TYPES = ["video/mp4", "video/webm", "video/quicktime", "image/jpeg", "image/png", "image/webp"];

const MediaFindingSchema = z.object({
  timestampSec: z.number().min(0).max(36000).nullable(),
  category: z.string().min(2).max(80),
  description: z.string().min(3).max(400),
  severity: z.enum(["info", "minor", "major", "critical"]),
  confidence: z.number().min(0).max(1),
});
const MediaSchema = z.object({ summary: z.string().min(5).max(800), findings: z.array(MediaFindingSchema).max(40) });

export interface MediaAnalysis {
  summary: string;
  findings: z.infer<typeof MediaFindingSchema>[];
  model: string;
}

/**
 * Ask the configured AI model to review footage or images. Results are ADVISORY: probabilistic model output that
 * always lands as "pending human review" — never an automatic accept/reject decision.
 */
export async function analyzeMedia(
  bytes: Buffer,
  mimeType: string,
  context: { station: string; standard: string | null; categories: readonly string[]; frames?: number[] },
): Promise<{ ok: true; analysis: MediaAnalysis } | { ok: false; status: number; error: string }> {
  const cfg = aiConfig();
  if (cfg.provider === "none") {
    return { ok: false, status: 503, error: cfg.disabled ? "AI is turned off in Integrations. Turn it on, or use the OpenCV check." : "No AI provider is configured. Choose one in Integrations (Gemini, Claude, OpenAI or a compatible endpoint)." };
  }
  if (!MEDIA_TYPES.includes(mimeType)) return { ok: false, status: 415, error: `Unsupported file type ${mimeType}. Use MP4, WebM, MOV, JPEG, PNG or WebP.` };
  if (bytes.byteLength > MEDIA_LIMIT_BYTES) return { ok: false, status: 413, error: "File is larger than 15 MB. Trim the clip and try again." };
  if (mimeType.startsWith("video/") && !aiCapabilities(cfg).video) {
    return { ok: false, status: 415, error: `${modelLabel(cfg)} can't watch video. Send still frames instead (the control room does this automatically), use the OpenCV motion check, or choose Gemini for video.` };
  }
  const contactSheet = !!context.frames?.length;
  const prompt = [
    "You are a visual quality-inspection assistant for an electronics factory.",
    `Station: ${context.station}. Applicable criteria: ${context.standard ?? "general visual inspection"}.`,
    contactSheet
      ? `The image is a contact sheet of ${context.frames!.length} frames from one clip, left to right and top to bottom, taken at ${context.frames!.map((t) => `${t}s`).join(", ")}. Treat it as video: give timestampSec from these times.`
      : "Review the attached footage and report ONLY what is clearly visible. Do not guess hidden details.",
    "Report ONLY what is clearly visible. Do not guess hidden details.",
    `Use one of these categories for each finding: ${context.categories.join("; ")}.`,
    'If nothing abnormal is visible, return a single finding with category "No defect visible".',
    contactSheet ? "" : "For video, give timestampSec where the issue is visible; for images use null.",
    "confidence is your own 0–1 estimate. Safety observations are advisory only. Never state that a part is certified or compliant.",
  ]
    .filter(Boolean)
    .join("\n");
  const responseSchema = {
    type: "object",
    properties: {
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            timestampSec: { type: ["number", "null"] },
            category: { type: "string", enum: [...context.categories] },
            description: { type: "string" },
            severity: { type: "string", enum: ["info", "minor", "major", "critical"] },
            confidence: { type: "number" },
          },
          required: ["timestampSec", "category", "description", "severity", "confidence"],
        },
      },
    },
    required: ["summary", "findings"],
  };
  try {
    const r = await llmGenerate({ prompt, media: [{ mimeType, data: bytes.toString("base64") }], json: { name: "visual_review", schema: responseSchema }, temperature: 0, maxOutputTokens: 8192, timeoutMs: 45000 });
    const parsed = MediaSchema.parse(r.json);
    const allowed = new Set(context.categories);
    const findings = parsed.findings.map((f) => ({ ...f, category: allowed.has(f.category) ? f.category : "Other" }));
    return { ok: true, analysis: { summary: parsed.summary, findings, model: r.model } };
  } catch (e) {
    if (e instanceof AiUnsupported) return { ok: false, status: 415, error: e.message };
    return { ok: false, status: 502, error: `AI review failed: ${errorMessage(e).slice(0, 200)}` };
  }
}
