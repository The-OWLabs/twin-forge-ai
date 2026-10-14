import "server-only";
import { BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse } from "@google/adk";
import type { AiConfig } from "@/server/ai/config";
import { chatOnce, withRetry, type ChatMessage, type ChatPart, type ChatTool } from "@/server/ai/llm";

/**
 * An ADK model backed by Claude, OpenAI or an OpenAI-compatible endpoint. ADK speaks Gemini's
 * content format; this adapter translates the conversation, the function declarations and the
 * function calls both ways, so the same multi-agent copilot (coordinator, specialists, the
 * confirmation gate) runs on any provider.
 */
export class ProviderLlm extends BaseLlm {
  constructor(private readonly cfg: AiConfig) {
    super({ model: cfg.model });
  }

  async *generateContentAsync(req: LlmRequest): AsyncGenerator<LlmResponse, void> {
    const config = (req.config ?? {}) as { systemInstruction?: unknown; tools?: unknown[]; maxOutputTokens?: number; temperature?: number };
    const r = await withRetry(() =>
      chatOnce(this.cfg, {
        system: systemText(config.systemInstruction),
        messages: toMessages(req.contents as unknown as GeminiContent[]),
        tools: toTools(config.tools),
        maxOutputTokens: config.maxOutputTokens ?? 4096,
        temperature: config.temperature,
        timeoutMs: this.cfg.timeoutMs,
      }),
    );
    const parts: Record<string, unknown>[] = [];
    if (r.text) parts.push({ text: r.text });
    for (const c of r.toolCalls) parts.push({ functionCall: { id: c.id, name: c.name, args: c.args } });
    if (!parts.length) parts.push({ text: "" });
    yield { content: { role: "model", parts }, turnComplete: true } as LlmResponse;
  }

  async connect(): Promise<BaseLlmConnection> {
    throw new Error("Live (streaming audio/video) sessions need Gemini.");
  }
}

type GeminiPart = { text?: string; thought?: boolean; functionCall?: { id?: string; name?: string; args?: Record<string, unknown> }; functionResponse?: { id?: string; name?: string; response?: unknown }; inlineData?: { mimeType?: string; data?: string } };
type GeminiContent = { role?: string; parts?: GeminiPart[] };

function systemText(si: unknown): string | undefined {
  if (!si) return undefined;
  if (typeof si === "string") return si;
  const parts = (si as GeminiContent).parts ?? (Array.isArray(si) ? (si as GeminiPart[]) : []);
  const text = parts.map((p) => p.text ?? "").filter(Boolean).join("\n");
  return text || undefined;
}

/** Gemini contents → neutral messages. Calls without ids get stable ids, matched to their responses by order. */
export function toMessages(contents: GeminiContent[]): ChatMessage[] {
  const pending = new Map<string, string[]>(); // function name → ids awaiting a response
  let n = 0;
  const out: ChatMessage[] = [];
  for (const c of contents ?? []) {
    const role = c.role === "model" ? "assistant" : "user";
    const parts: ChatPart[] = [];
    for (const p of c.parts ?? []) {
      if (p.thought) continue;
      if (p.functionCall?.name) {
        const id = p.functionCall.id || `call_${++n}`;
        pending.set(p.functionCall.name, [...(pending.get(p.functionCall.name) ?? []), id]);
        parts.push({ type: "tool_call", id, name: p.functionCall.name, args: p.functionCall.args ?? {} });
      } else if (p.functionResponse?.name) {
        const queue = pending.get(p.functionResponse.name) ?? [];
        const id = p.functionResponse.id || queue[0] || `call_${++n}`;
        pending.set(p.functionResponse.name, queue.filter((x) => x !== id));
        parts.push({ type: "tool_result", id, name: p.functionResponse.name, result: p.functionResponse.response ?? null });
      } else if (p.inlineData?.data && p.inlineData.mimeType) parts.push({ type: "media", mimeType: p.inlineData.mimeType, data: p.inlineData.data });
      else if (p.text) parts.push({ type: "text", text: p.text });
    }
    if (parts.length) out.push({ role, parts });
  }
  return out;
}

/** Gemini Schema (OBJECT/STRING…, nullable) → JSON Schema. */
export function toJsonSchema(s: unknown): Record<string, unknown> {
  if (!s || typeof s !== "object") return { type: "object", properties: {} };
  const src = s as { type?: string; properties?: Record<string, unknown>; items?: unknown; required?: string[]; enum?: unknown[]; nullable?: boolean; description?: string; minimum?: number; maximum?: number; anyOf?: unknown[] };
  const out: Record<string, unknown> = {};
  const type = typeof src.type === "string" ? src.type.toLowerCase() : undefined;
  if (type && type !== "type_unspecified") out.type = src.nullable ? [type, "null"] : type;
  if (src.description) out.description = src.description;
  if (src.enum) out.enum = src.nullable ? [...src.enum, null] : src.enum;
  if (src.minimum !== undefined) out.minimum = src.minimum;
  if (src.maximum !== undefined) out.maximum = src.maximum;
  if (src.properties) out.properties = Object.fromEntries(Object.entries(src.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  if (src.items) out.items = toJsonSchema(src.items);
  if (src.required?.length) out.required = src.required;
  if (src.anyOf) out.anyOf = src.anyOf.map(toJsonSchema);
  if (type === "object" && !out.properties) out.properties = {};
  return out;
}

function toTools(tools: unknown[] | undefined): ChatTool[] {
  const out: ChatTool[] = [];
  for (const t of tools ?? []) {
    for (const fd of ((t as { functionDeclarations?: unknown[] }).functionDeclarations ?? []) as { name?: string; description?: string; parameters?: unknown; parametersJsonSchema?: Record<string, unknown> }[]) {
      if (!fd.name) continue;
      const parameters = fd.parametersJsonSchema ?? toJsonSchema(fd.parameters);
      out.push({ name: fd.name, description: fd.description, parameters: parameters.type ? parameters : { type: "object", properties: {} } });
    }
  }
  return out;
}
