import "server-only";
import { defaultAiProvider, setting, type AiProviderId } from "@/server/settings";

/**
 * Which AI platform the app uses, chosen in Integrations (or the environment). Every AI feature
 * goes through this: narratives, footage review, the Twin Builder and the ADK copilot.
 */

export interface AiConfig {
  provider: AiProviderId | "none";
  model: string;
  project?: string;
  location?: string;
  baseUrl?: string;
  timeoutMs: number;
  missing: string[];
  /** Turned off in Integrations (AI_ENABLED=false). */
  disabled?: boolean;
  /** The provider that would run if it were configured (for messages). */
  wanted?: AiProviderId;
}

export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  vertex: "gemini-3.5-flash",
  "gemini-api": "gemini-3.5-flash",
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-6-luna",
  "openai-compatible": "",
};

export function aiConfig(): AiConfig {
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 30000);
  const wanted = (setting("AI_PROVIDER") || defaultAiProvider()) as AiProviderId;
  const none = (missing: string[], disabled = false): AiConfig => ({ provider: "none", model: "", timeoutMs, missing, disabled, wanted });
  if ((setting("AI_ENABLED") ?? "true").toLowerCase() === "false") return none([], true);
  switch (wanted) {
    case "vertex": {
      const project = setting("GOOGLE_CLOUD_PROJECT");
      if (!project) return none(["Google Cloud project (+ Application Default Credentials) for Vertex AI"]);
      return { provider: "vertex", model: setting("GEMINI_MODEL") || DEFAULT_MODELS.vertex, project, location: setting("GOOGLE_CLOUD_LOCATION") || "global", timeoutMs, missing: [], wanted };
    }
    case "gemini-api":
      if (!setting("GEMINI_API_KEY")) return none(["Gemini API key"]);
      return { provider: "gemini-api", model: setting("GEMINI_MODEL") || DEFAULT_MODELS["gemini-api"], timeoutMs, missing: [], wanted };
    case "anthropic":
      if (!setting("ANTHROPIC_API_KEY")) return none(["Anthropic API key"]);
      return { provider: "anthropic", model: setting("ANTHROPIC_MODEL") || DEFAULT_MODELS.anthropic, timeoutMs: Math.max(timeoutMs, 60000), missing: [], wanted };
    case "openai":
      if (!setting("OPENAI_API_KEY")) return none(["OpenAI API key"]);
      return { provider: "openai", model: setting("OPENAI_MODEL") || DEFAULT_MODELS.openai, baseUrl: "https://api.openai.com/v1", timeoutMs: Math.max(timeoutMs, 60000), missing: [], wanted };
    case "openai-compatible": {
      const baseUrl = (setting("OPENAI_BASE_URL") ?? "").replace(/\/+$/, "");
      const model = setting("OPENAI_MODEL") ?? "";
      const missing = [...(baseUrl ? [] : ["endpoint URL"]), ...(model ? [] : ["model name"])];
      if (missing.length) return none(missing);
      return { provider: "openai-compatible", model, baseUrl, timeoutMs: Math.max(timeoutMs, 90000), missing: [], wanted };
    }
    default:
      return none([`unknown provider "${wanted}"`]);
  }
}

export const PROVIDER_NAME: Record<AiProviderId, string> = {
  vertex: "Gemini on Vertex AI",
  "gemini-api": "Gemini API",
  anthropic: "Claude (Anthropic API)",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-compatible endpoint",
};

/** "claude-sonnet-5-5 via Anthropic API" — shown wherever AI output appears. */
export function modelLabel(cfg: AiConfig): string {
  switch (cfg.provider) {
    case "vertex":
      return `${cfg.model} via Vertex AI (${cfg.location})`;
    case "gemini-api":
      return `${cfg.model} via Gemini API`;
    case "anthropic":
      return `${cfg.model} via Anthropic API`;
    case "openai":
      return `${cfg.model} via OpenAI`;
    case "openai-compatible":
      return `${cfg.model} via ${safeHost(cfg.baseUrl)}`;
    default:
      return "none";
  }
}

const safeHost = (u?: string) => {
  try {
    return new URL(u ?? "").host;
  } catch {
    return "custom endpoint";
  }
};

/** What the configured provider can do; features that need more say so instead of failing. */
export function aiCapabilities(cfg: AiConfig = aiConfig()) {
  const p = cfg.provider;
  return {
    available: p !== "none",
    video: p === "vertex" || p === "gemini-api",
    images: p !== "none",
    pdf: p === "vertex" || p === "gemini-api" || p === "anthropic" || p === "openai",
    webSearch: p === "vertex" || p === "gemini-api" || p === "anthropic" || p === "openai",
  };
}

type AiRuntime = { lastSuccessAt: string | null; lastError: string | null; lastLatencyMs: number | null; calls: number };
const g = globalThis as unknown as { __twinforgeAi?: AiRuntime };
const runtime: AiRuntime = (g.__twinforgeAi ??= { lastSuccessAt: null, lastError: null, lastLatencyMs: null, calls: 0 });

export function aiRuntime() {
  return { ...runtime };
}

/** Forget the last call's outcome (after the AI settings change, so the status reflects the new configuration). */
export function resetAiRuntime() {
  runtime.lastSuccessAt = null;
  runtime.lastError = null;
  runtime.lastLatencyMs = null;
}

export function recordAiCall() {
  runtime.calls++;
}
export function recordAiSuccess(latencyMs: number) {
  runtime.lastSuccessAt = new Date().toISOString();
  runtime.lastLatencyMs = latencyMs;
  runtime.lastError = null;
}
export function recordAiError(msg: string) {
  runtime.lastError = `${new Date().toISOString()} — ${msg}`.slice(0, 400);
}
