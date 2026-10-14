import "server-only";
import { setting } from "@/server/settings";
import { aiCapabilities, aiConfig, modelLabel, recordAiCall, recordAiError, recordAiSuccess, type AiConfig } from "./config";

/**
 * One provider-neutral way to call a language model: Gemini (Vertex AI or API key), Claude
 * (Anthropic Messages API), OpenAI (Responses API) or any OpenAI-compatible endpoint (Chat
 * Completions). Supports images and PDFs, structured JSON output, client tools (for the ADK
 * copilot) and web search with citations where the provider has it. Every caller validates the
 * output itself; a provider that cannot do something says so (AiUnsupported) instead of guessing.
 */

export interface Media {
  mimeType: string;
  /** Base64 data. */
  data: string;
}
export interface ChatTool {
  name: string;
  description?: string;
  /** JSON Schema of the arguments (an object schema). */
  parameters: Record<string, unknown>;
}
export type ChatPart =
  | { type: "text"; text: string }
  | { type: "media"; mimeType: string; data: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown };
export interface ChatMessage {
  role: "user" | "assistant";
  parts: ChatPart[];
}
export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  /** Force a JSON result matching this schema. */
  json?: { name: string; schema: Record<string, unknown> };
  webSearch?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  /** Gemini only: keep reasoning short (faster, cheaper). */
  thinkingLow?: boolean;
  timeoutMs: number;
}
export interface Citation {
  id: string;
  url: string;
  title: string;
}
export interface ChatResult {
  text: string;
  json?: unknown;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
  /** Web sources, numbered R1, R2… in order of first use. */
  citations: Citation[];
  /** `text` with [R#] markers after the passages each source supports. */
  markedText: string;
  queries: string[];
  /** Google Search suggestions HTML, which must be shown with grounded Gemini results. */
  searchEntryPoint: string | null;
}

export class AiUnsupported extends Error {
  status = 415;
}

/* ───────────────────────────── shared helpers ───────────────────────────── */

const RETRYABLE = /\b(429|500|502|503|504|529)\b|overloaded|DEADLINE_EXCEEDED|UNAVAILABLE|RESOURCE_EXHAUSTED|timed out|fetch failed|ECONNRESET/i;

export async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = errorMessage(e);
      if (attempt >= retries || e instanceof AiUnsupported || !RETRYABLE.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, /429|RESOURCE_EXHAUSTED|overloaded|529/i.test(msg) ? 2000 : 300));
    }
  }
}

export const errorMessage = (e: unknown) => (e instanceof Error ? (e.name === "AbortError" || e.name === "TimeoutError" ? "timed out" : e.message) : String(e));

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { message: text.slice(0, 300) } };
  }
  if (!res.ok) {
    const err = (data.error ?? {}) as { message?: string; type?: string };
    throw new Error(`${res.status} ${err.message ?? err.type ?? res.statusText}`.slice(0, 400));
  }
  return data;
}

const dataUrl = (m: Media) => `data:${m.mimeType};base64,${m.data}`;
const isImage = (m: { mimeType: string }) => m.mimeType.startsWith("image/");
const isPdf = (m: { mimeType: string }) => m.mimeType === "application/pdf";
const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "call";

/** Number sources in order of first use. */
function citationBook() {
  const list: Citation[] = [];
  const byUrl = new Map<string, string>();
  const idFor = (url: string, title: string) => {
    if (!byUrl.has(url)) {
      if (list.length >= 15) return null;
      const id = `R${list.length + 1}`;
      byUrl.set(url, id);
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {
        /* keep the raw url */
      }
      list.push({ id, url, title: (title || host).slice(0, 200) });
    }
    return byUrl.get(url)!;
  };
  return { list, idFor };
}

const parseJson = (text: string) => JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));

/* ───────────────────────────── Claude (Anthropic Messages API) ───────────────────────────── */

function toAnthropic(messages: ChatMessage[]) {
  const out: { role: "user" | "assistant"; content: Record<string, unknown>[] }[] = [];
  for (const m of messages) {
    const blocks: Record<string, unknown>[] = [];
    for (const p of m.parts) {
      if (p.type === "text") {
        if (p.text) blocks.push({ type: "text", text: p.text });
      } else if (p.type === "media") {
        if (isImage(p)) blocks.push({ type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data } });
        else if (isPdf(p)) blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data } });
        else throw new AiUnsupported(`Claude can't read ${p.mimeType} files. Use images or PDFs, or choose Gemini for video.`);
      } else if (p.type === "tool_call") blocks.push({ type: "tool_use", id: safeId(p.id), name: p.name, input: p.args ?? {} });
      else blocks.push({ type: "tool_result", tool_use_id: safeId(p.id), content: typeof p.result === "string" ? p.result : JSON.stringify(p.result ?? null) });
    }
    if (!blocks.length) continue;
    // Tool results must come first in a user turn.
    blocks.sort((a, b) => Number(b.type === "tool_result") - Number(a.type === "tool_result"));
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(...blocks);
    else out.push({ role: m.role, content: blocks });
  }
  if (out[0]?.role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "Continue." }] });
  return out;
}

async function anthropicChat(cfg: AiConfig, req: ChatRequest): Promise<ChatResult> {
  const key = setting("ANTHROPIC_API_KEY") ?? "";
  const tools: Record<string, unknown>[] = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.parameters }));
  if (req.json) tools.push({ name: req.json.name, description: "Return the result in exactly this structure.", input_schema: req.json.schema });
  if (req.webSearch) tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
  const body: Record<string, unknown> = { model: cfg.model, max_tokens: req.maxOutputTokens ?? 4096, messages: toAnthropic(req.messages) };
  if (req.system) body.system = req.system;
  if (req.temperature != null) body.temperature = req.temperature;
  if (tools.length) body.tools = tools;
  if (req.json) body.tool_choice = { type: "tool", name: req.json.name };
  const headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };

  type Block = { type: string; text?: string; citations?: { url?: string; title?: string }[]; id?: string; name?: string; input?: unknown };
  let content: Block[] = [];
  // A long server-side search turn can pause; continue it (at most twice).
  for (let i = 0; i < 3; i++) {
    const data = (await postJson("https://api.anthropic.com/v1/messages", headers, body, req.timeoutMs)) as { content?: Block[]; stop_reason?: string };
    content = [...content, ...(data.content ?? [])];
    if (data.stop_reason !== "pause_turn") break;
    body.messages = [...(body.messages as unknown[]), { role: "assistant", content: data.content }];
  }
  const book = citationBook();
  let text = "";
  let marked = "";
  const toolCalls: ChatResult["toolCalls"] = [];
  const queries: string[] = [];
  let json: unknown;
  for (const b of content) {
    if (b.type === "text" && b.text) {
      text += b.text;
      const ids = [...new Set((b.citations ?? []).map((c) => (c.url ? book.idFor(c.url, c.title ?? "") : null)).filter((x): x is string => !!x))];
      marked += b.text + (ids.length ? ` [${ids.join(", ")}]` : "");
    } else if (b.type === "tool_use" && b.name) {
      if (req.json && b.name === req.json.name) json = b.input;
      else toolCalls.push({ id: b.id ?? `call_${toolCalls.length}`, name: b.name, args: (b.input ?? {}) as Record<string, unknown> });
    } else if (b.type === "server_tool_use") {
      const q = (b.input as { query?: string } | undefined)?.query;
      if (q) queries.push(q);
    }
  }
  if (req.json && json === undefined) throw new Error("Claude did not return the structured result.");
  return { text, json, toolCalls, citations: book.list, markedText: marked, queries, searchEntryPoint: null };
}

/* ───────────────────────────── OpenAI (Responses API) ───────────────────────────── */

function toResponsesInput(messages: ChatMessage[]) {
  const items: Record<string, unknown>[] = [];
  for (const m of messages) {
    const content: Record<string, unknown>[] = [];
    for (const p of m.parts) {
      if (p.type === "text") {
        if (p.text) content.push({ type: m.role === "user" ? "input_text" : "output_text", text: p.text });
      } else if (p.type === "media") {
        if (isImage(p)) content.push({ type: "input_image", image_url: dataUrl(p) });
        else if (isPdf(p)) content.push({ type: "input_file", filename: "document.pdf", file_data: dataUrl(p) });
        else throw new AiUnsupported(`OpenAI can't read ${p.mimeType} files here. Use images or PDFs, or choose Gemini for video.`);
      } else if (p.type === "tool_call") items.push({ type: "function_call", call_id: p.id, name: p.name, arguments: JSON.stringify(p.args ?? {}) });
      else items.push({ type: "function_call_output", call_id: p.id, output: typeof p.result === "string" ? p.result : JSON.stringify(p.result ?? null) });
    }
    if (content.length) items.push({ role: m.role, content });
  }
  return items;
}

async function openaiResponsesChat(cfg: AiConfig, req: ChatRequest): Promise<ChatResult> {
  const tools: Record<string, unknown>[] = (req.tools ?? []).map((t) => ({ type: "function", name: t.name, description: t.description ?? "", parameters: t.parameters, strict: false }));
  if (req.webSearch) tools.push({ type: "web_search" });
  const body: Record<string, unknown> = { model: cfg.model, input: toResponsesInput(req.messages), max_output_tokens: req.maxOutputTokens ?? 4096 };
  if (req.system) body.instructions = req.system;
  if (tools.length) body.tools = tools;
  if (req.json) body.text = { format: { type: "json_schema", name: req.json.name, schema: req.json.schema, strict: false } };
  const data = (await postJson(`${cfg.baseUrl ?? "https://api.openai.com/v1"}/responses`, { authorization: `Bearer ${setting("OPENAI_API_KEY") ?? ""}` }, body, req.timeoutMs)) as {
    output?: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string; end_index?: number }[] }[]; call_id?: string; name?: string; arguments?: string; action?: { query?: string } }[];
  };
  const book = citationBook();
  let text = "";
  let marked = "";
  const toolCalls: ChatResult["toolCalls"] = [];
  const queries: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) {
        if (c.type !== "output_text" || !c.text) continue;
        text += c.text;
        // Insert [R#] at the end of each cited span, last first so indices stay valid.
        let t = c.text;
        const marks = (c.annotations ?? [])
          .filter((a) => a.type === "url_citation" && a.url && a.end_index != null)
          .map((a) => ({ at: a.end_index!, id: book.idFor(a.url!, a.title ?? "") }))
          .filter((m): m is { at: number; id: string } => !!m.id)
          .sort((a, b) => b.at - a.at);
        for (const m of marks) t = `${t.slice(0, m.at)} [${m.id}]${t.slice(m.at)}`;
        marked += t;
      }
    } else if (item.type === "function_call" && item.name) {
      let args: Record<string, unknown> = {};
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        /* malformed arguments: the tool layer reports the validation error */
      }
      toolCalls.push({ id: item.call_id ?? `call_${toolCalls.length}`, name: item.name, args });
    } else if (item.type === "web_search_call" && item.action?.query) queries.push(item.action.query);
  }
  return { text, json: req.json ? parseJson(text) : undefined, toolCalls, citations: book.list, markedText: marked, queries, searchEntryPoint: null };
}

/* ───────────────────────────── OpenAI-compatible (Chat Completions) ───────────────────────────── */

function toChatMessages(system: string | undefined, messages: ChatMessage[]) {
  const out: Record<string, unknown>[] = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "user") {
      const content: Record<string, unknown>[] = [];
      for (const p of m.parts) {
        if (p.type === "tool_result") out.push({ role: "tool", tool_call_id: p.id, content: typeof p.result === "string" ? p.result : JSON.stringify(p.result ?? null) });
        else if (p.type === "text" && p.text) content.push({ type: "text", text: p.text });
        else if (p.type === "media") {
          if (!isImage(p)) throw new AiUnsupported(`This endpoint takes images only; ${p.mimeType} is not supported. Choose Gemini, Claude or OpenAI for PDFs and Gemini for video.`);
          content.push({ type: "image_url", image_url: { url: dataUrl(p) } });
        }
      }
      if (content.length) out.push({ role: "user", content: content.length === 1 && content[0].type === "text" ? content[0].text : content });
    } else {
      const text = m.parts.filter((p): p is Extract<ChatPart, { type: "text" }> => p.type === "text").map((p) => p.text).join("");
      const calls = m.parts.filter((p): p is Extract<ChatPart, { type: "tool_call" }> => p.type === "tool_call");
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) } : {}) });
    }
  }
  return out;
}

async function compatibleChat(cfg: AiConfig, req: ChatRequest): Promise<ChatResult> {
  if (req.webSearch) throw new AiUnsupported("Web search is not available on OpenAI-compatible endpoints. Choose Gemini, Claude or OpenAI for cited research.");
  const system = req.json ? `${req.system ?? ""}\n\nRespond with only a JSON object that matches this JSON Schema:\n${JSON.stringify(req.json.schema)}`.trim() : req.system;
  const body: Record<string, unknown> = { model: cfg.model, messages: toChatMessages(system, req.messages), max_tokens: req.maxOutputTokens ?? 4096 };
  if (req.temperature != null) body.temperature = req.temperature;
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.parameters } }));
  if (req.json) body.response_format = { type: "json_object" };
  const key = setting("OPENAI_API_KEY");
  const data = (await postJson(`${cfg.baseUrl}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, body, req.timeoutMs)) as {
    choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
  };
  const msg = data.choices?.[0]?.message ?? {};
  const text = msg.content ?? "";
  const toolCalls = (msg.tool_calls ?? []).map((c, i) => {
    let args: Record<string, unknown> = {};
    try {
      args = c.function?.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      /* malformed arguments: the tool layer reports the validation error */
    }
    return { id: c.id ?? `call_${i}`, name: c.function?.name ?? "", args };
  });
  return { text, json: req.json ? parseJson(text) : undefined, toolCalls, citations: [], markedText: text, queries: [], searchEntryPoint: null };
}

/* ───────────────────────────── Gemini (Vertex AI or API key) ───────────────────────────── */

/** Insert [R#] markers after the sentences each grounding chunk supports. */
function citeNotes(text: string, supports: { segment?: { text?: string }; groundingChunkIndices?: number[] }[], refIdForChunk: (i: number) => string | null) {
  let out = text;
  const seen = new Set<string>();
  for (const s of supports) {
    const seg = s.segment?.text?.trim();
    if (!seg || seen.has(seg)) continue;
    seen.add(seg);
    const ids = [...new Set((s.groundingChunkIndices ?? []).map(refIdForChunk).filter((x): x is string => !!x))];
    if (!ids.length) continue;
    const at = out.indexOf(seg);
    if (at >= 0) out = `${out.slice(0, at + seg.length)} [${ids.join(", ")}]${out.slice(at + seg.length)}`;
  }
  return out;
}

async function geminiChat(cfg: AiConfig, req: ChatRequest): Promise<ChatResult> {
  if (req.tools?.length) throw new Error("Gemini tool calls go through the ADK agent, not this helper.");
  const { GoogleGenAI, ThinkingLevel } = await import("@google/genai");
  const ai =
    cfg.provider === "vertex"
      ? new GoogleGenAI({ vertexai: true, project: cfg.project, location: cfg.location, httpOptions: { timeout: req.timeoutMs } })
      : new GoogleGenAI({ apiKey: setting("GEMINI_API_KEY"), httpOptions: { timeout: req.timeoutMs } });
  const contents = req.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: m.parts.flatMap((p): Record<string, unknown>[] => (p.type === "text" ? [{ text: p.text }] : p.type === "media" ? [{ inlineData: { mimeType: p.mimeType, data: p.data } }] : [])),
  }));
  const config: Record<string, unknown> = { abortSignal: AbortSignal.timeout(req.timeoutMs), maxOutputTokens: req.maxOutputTokens ?? 4096 };
  if (req.system) config.systemInstruction = req.system;
  if (req.temperature != null) config.temperature = req.temperature;
  if (req.thinkingLow) config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  if (req.json) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = req.json.schema;
  }
  if (req.webSearch) config.tools = [{ googleSearch: {} }];
  const res = await ai.models.generateContent({ model: cfg.model, contents: contents as never, config: config as never });
  const text = res.text ?? "";
  const gm = (res.candidates?.[0]?.groundingMetadata ?? {}) as {
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
    webSearchQueries?: string[];
    searchEntryPoint?: { renderedContent?: string };
  };
  const book = citationBook();
  const chunkRef = (gm.groundingChunks ?? []).map((c) => (c.web?.uri ? book.idFor(c.web.uri, c.web.title ?? "") : null));
  return {
    text,
    json: req.json ? parseJson(text) : undefined,
    toolCalls: [],
    citations: book.list,
    markedText: req.webSearch ? citeNotes(text, gm.groundingSupports ?? [], (i) => chunkRef[i] ?? null) : text,
    queries: gm.webSearchQueries ?? [],
    searchEntryPoint: gm.searchEntryPoint?.renderedContent ?? null,
  };
}

/* ───────────────────────────── entry points ───────────────────────────── */

/** One model turn on the configured provider (no retry, no bookkeeping). */
export function chatOnce(cfg: AiConfig, req: ChatRequest): Promise<ChatResult> {
  switch (cfg.provider) {
    case "anthropic":
      return anthropicChat(cfg, req);
    case "openai":
      return openaiResponsesChat(cfg, req);
    case "openai-compatible":
      return compatibleChat(cfg, req);
    case "vertex":
    case "gemini-api":
      return geminiChat(cfg, req);
    default:
      throw new Error("No AI provider is configured.");
  }
}

export interface GenerateRequest {
  system?: string;
  prompt: string;
  media?: Media[];
  json?: { name: string; schema: Record<string, unknown> };
  webSearch?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  thinkingLow?: boolean;
  timeoutMs?: number;
}

/**
 * A single prompt (with optional files) to the configured provider, with one retry on transient
 * errors and status bookkeeping for the Integrations page.
 */
export async function llmGenerate(req: GenerateRequest): Promise<ChatResult & { model: string; latencyMs: number }> {
  const cfg = aiConfig();
  if (cfg.provider === "none") throw new Error(cfg.disabled ? "AI is turned off in Integrations." : `AI is not configured: ${cfg.missing.join(", ")}.`);
  const caps = aiCapabilities(cfg);
  if (req.webSearch && !caps.webSearch) throw new AiUnsupported(`Web search isn't available with ${modelLabel(cfg)}.`);
  const timeoutMs = Math.max(req.timeoutMs ?? cfg.timeoutMs, cfg.timeoutMs);
  const started = Date.now();
  recordAiCall();
  try {
    const r = await withRetry(() =>
      chatOnce(cfg, {
        system: req.system,
        messages: [{ role: "user", parts: [...(req.media ?? []).map((m) => ({ type: "media" as const, ...m })), { type: "text" as const, text: req.prompt }] }],
        json: req.json,
        webSearch: req.webSearch,
        maxOutputTokens: req.maxOutputTokens,
        temperature: req.temperature,
        thinkingLow: req.thinkingLow,
        timeoutMs,
      }),
    );
    const latencyMs = Date.now() - started;
    recordAiSuccess(latencyMs);
    return { ...r, model: modelLabel(cfg), latencyMs };
  } catch (e) {
    const msg = errorMessage(e);
    if (!(e instanceof AiUnsupported)) recordAiError(msg);
    throw e instanceof AiUnsupported ? e : new Error(msg);
  }
}
