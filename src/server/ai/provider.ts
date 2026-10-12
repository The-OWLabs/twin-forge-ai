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
