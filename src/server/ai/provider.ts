import "server-only";
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

export interface AiConfig {
  provider: "vertex" | "gemini-api" | "none";
  model: string;
  project?: string;
  location?: string;
  timeoutMs: number;
  missing: string[];
}

export function aiConfig(): AiConfig {
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 12000);
  const useVertex = (process.env.GOOGLE_GENAI_USE_VERTEXAI ?? "true").toLowerCase() !== "false";
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
  if (useVertex && project) return { provider: "vertex", model, project, location, timeoutMs, missing: [] };
  if (process.env.GEMINI_API_KEY) return { provider: "gemini-api", model, timeoutMs, missing: [] };
  return {
    provider: "none",
    model,
    timeoutMs,
    missing: ["GOOGLE_CLOUD_PROJECT (+ Application Default Credentials) for Vertex AI, or GEMINI_API_KEY"],
  };
}

type AiRuntime = { lastSuccessAt: string | null; lastError: string | null; lastLatencyMs: number | null; calls: number };
const g = globalThis as unknown as { __twinforgeAi?: AiRuntime };
const runtime: AiRuntime = (g.__twinforgeAi ??= { lastSuccessAt: null, lastError: null, lastLatencyMs: null, calls: 0 });

export function aiRuntime() {
  return { ...runtime };
}

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

async function callGemini(cfg: AiConfig, input: NarrativeInput): Promise<Narrative> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai =
    cfg.provider === "vertex"
      ? new GoogleGenAI({ vertexai: true, project: cfg.project, location: cfg.location, httpOptions: { timeout: cfg.timeoutMs } })
      : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: cfg.timeoutMs } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const started = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: cfg.model,
      contents: buildPrompt(input),
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 1200,
        abortSignal: controller.signal,
      },
    });
    const text = res.text ?? "";
    const parsed = NarrativeSchema.parse(JSON.parse(text));
    const all = [parsed.summary, parsed.rationale, parsed.operatorBriefing, ...parsed.risks].join(" ");
    const bad = ungroundedFigures(all, input);
    runtime.lastLatencyMs = Date.now() - started;
    if (bad.length) {
      throw new Error(`grounding check failed — figure(s) ${bad.slice(0, 3).join(", ")} not found in simulation outputs`);
    }
    runtime.lastSuccessAt = new Date().toISOString();
    runtime.lastError = null;
    return {
      source: "gemini",
      model: `${cfg.model} via ${cfg.provider === "vertex" ? `Vertex AI (${cfg.location})` : "Gemini API"}`,
      ...parsed,
      note: `Schema-validated; all figures traced to simulation outputs. ${runtime.lastLatencyMs} ms.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateNarrative(input: NarrativeInput): Promise<Narrative> {
  const cfg = aiConfig();
  if (cfg.provider === "none") {
    return deterministicNarrative(input, "Gemini not configured — deterministic narrative generated from simulation outputs.");
  }
  runtime.calls++;
  try {
    return await callGemini(cfg, input);
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timed out after ${cfg.timeoutMs} ms` : e.message) : String(e);
    runtime.lastError = `${new Date().toISOString()} — ${msg}`.slice(0, 400);
    return deterministicNarrative(input, `Gemini call failed (${msg.slice(0, 160)}); fell back to deterministic narrative.`);
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
  try {
    const n = await callGemini(cfg, sample);
    return { ok: true, detail: `${n.model} responded (${runtime.lastLatencyMs} ms).` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    runtime.lastError = `${new Date().toISOString()} — ${msg}`.slice(0, 400);
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
 * Ask Gemini to review uploaded footage. Results are ADVISORY: probabilistic model output that
 * always lands as "pending human review" — never an automatic accept/reject decision.
 */
export async function analyzeMedia(
  bytes: Buffer,
  mimeType: string,
  context: { station: string; standard: string | null; categories: readonly string[] },
): Promise<{ ok: true; analysis: MediaAnalysis } | { ok: false; status: number; error: string }> {
  const cfg = aiConfig();
  if (cfg.provider === "none") {
    return { ok: false, status: 503, error: "Gemini is not configured. Enable Vertex AI (GOOGLE_CLOUD_PROJECT) or set GEMINI_API_KEY to analyze uploaded footage." };
  }
  if (!MEDIA_TYPES.includes(mimeType)) return { ok: false, status: 415, error: `Unsupported file type ${mimeType}. Use MP4, WebM, MOV, JPEG, PNG or WebP.` };
  if (bytes.byteLength > MEDIA_LIMIT_BYTES) return { ok: false, status: 413, error: "File is larger than 15 MB. Trim the clip and try again." };
  const prompt = [
    "You are a visual quality-inspection assistant for an electronics factory.",
    `Station: ${context.station}. Applicable criteria: ${context.standard ?? "general visual inspection"}.`,
    "Review the attached footage and report ONLY what is clearly visible. Do not guess hidden details.",
    `Use one of these categories for each finding: ${context.categories.join("; ")}.`,
    'If nothing abnormal is visible, return a single finding with category "No defect visible".',
    "For video, give timestampSec where the issue is visible; for images use null.",
    "confidence is your own 0–1 estimate. Safety observations are advisory only. Never state that a part is certified or compliant.",
  ].join("\n");
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
  runtime.calls++;
  const started = Date.now();
  const timeoutMs = Math.max(cfg.timeoutMs, 45000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai =
      cfg.provider === "vertex"
        ? new GoogleGenAI({ vertexai: true, project: cfg.project, location: cfg.location, httpOptions: { timeout: timeoutMs } })
        : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: timeoutMs } });
    const res = await ai.models.generateContent({
      model: cfg.model,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: bytes.toString("base64") } }, { text: prompt }] }],
      config: { responseMimeType: "application/json", responseJsonSchema: responseSchema, temperature: 0, maxOutputTokens: 2048, abortSignal: controller.signal },
    });
    const parsed = MediaSchema.parse(JSON.parse(res.text ?? ""));
    const allowed = new Set(context.categories);
    const findings = parsed.findings.map((f) => ({ ...f, category: allowed.has(f.category) ? f.category : "Other" }));
    runtime.lastSuccessAt = new Date().toISOString();
    runtime.lastLatencyMs = Date.now() - started;
    runtime.lastError = null;
    return { ok: true, analysis: { summary: parsed.summary, findings, model: `${cfg.model} via ${cfg.provider === "vertex" ? `Vertex AI (${cfg.location})` : "Gemini API"}` } };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timed out after ${timeoutMs} ms` : e.message) : String(e);
    runtime.lastError = `${new Date().toISOString()} — ${msg}`.slice(0, 400);
    return { ok: false, status: 502, error: `Gemini analysis failed: ${msg.slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}

/* ───────────────────────────── shared call helper ───────────────────────────── */

export interface GeminiCall {
  contents: unknown;
  config?: Record<string, unknown>;
  timeoutMs: number;
}

/**
 * One Gemini call with timeout and runtime bookkeeping (used by the Twin Builder agent).
 * Returns the raw response so callers can read text and grounding metadata.
 */
export async function geminiGenerate(call: GeminiCall) {
  const cfg = aiConfig();
  if (cfg.provider === "none") throw new Error("Gemini is not configured");
  const { GoogleGenAI } = await import("@google/genai");
  const ai =
    cfg.provider === "vertex"
      ? new GoogleGenAI({ vertexai: true, project: cfg.project, location: cfg.location, httpOptions: { timeout: call.timeoutMs } })
      : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: call.timeoutMs } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), call.timeoutMs);
  const started = Date.now();
  runtime.calls++;
  try {
    const res = await ai.models.generateContent({
      model: cfg.model,
      contents: call.contents as never,
      config: { ...(call.config ?? {}), abortSignal: controller.signal },
    });
    runtime.lastSuccessAt = new Date().toISOString();
    runtime.lastLatencyMs = Date.now() - started;
    runtime.lastError = null;
    return { res, model: `${cfg.model} via ${cfg.provider === "vertex" ? `Vertex AI (${cfg.location})` : "Gemini API"}`, latencyMs: Date.now() - started };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timed out after ${call.timeoutMs} ms` : e.message) : String(e);
    runtime.lastError = `${new Date().toISOString()} — ${msg}`.slice(0, 400);
    throw new Error(msg);
  } finally {
    clearTimeout(timer);
  }
}
