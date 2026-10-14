import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The provider adapters against recorded response shapes (no network): Claude (Messages API),
 * OpenAI (Responses API) and OpenAI-compatible endpoints (Chat Completions), plus the ADK model
 * adapter that lets the copilot run on them.
 */

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let calls: Call[] = [];
let replies: unknown[] = [];
let dir = "";

function mockFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      const next = replies.shift() ?? {};
      return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const settings = await import("@/server/settings");
  settings.__resetSettingsForTests();
  return { ...(await import("@/server/ai/config")), ...(await import("@/server/ai/llm")) };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-ai-"));
  vi.stubEnv("TWINFORGE_DATA_DIR", dir);
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  mockFetch();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

const KEY = "sk-test-0123456789abcdefghijklmnop";
const schema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };

describe("AI provider selection", () => {
  it("picks the provider from the settings and says what is missing", async () => {
    let m = await load({ AI_PROVIDER: "anthropic" });
    expect(m.aiConfig()).toMatchObject({ provider: "none", missing: ["Anthropic API key"], wanted: "anthropic" });
    m = await load({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: KEY });
    expect(m.aiConfig()).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(m.modelLabel(m.aiConfig())).toBe("claude-sonnet-5-5 via Anthropic API");
    expect(m.aiCapabilities()).toMatchObject({ video: false, images: true, pdf: true, webSearch: true });
    m = await load({ AI_PROVIDER: "openai-compatible", OPENAI_BASE_URL: "http://localhost:11434/v1/" });
    expect(m.aiConfig()).toMatchObject({ provider: "none", missing: ["model name"] });
    m = await load({ AI_PROVIDER: "openai-compatible", OPENAI_BASE_URL: "http://localhost:11434/v1/", OPENAI_MODEL: "llama3.3" });
    expect(m.aiConfig()).toMatchObject({ provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" });
    expect(m.aiCapabilities()).toMatchObject({ webSearch: false, pdf: false });
    m = await load({ AI_PROVIDER: "openai", OPENAI_API_KEY: KEY, AI_ENABLED: "false" });
    expect(m.aiConfig()).toMatchObject({ provider: "none", disabled: true });
  });
});

describe("Claude (Anthropic Messages API)", () => {
  it("returns structured JSON through a forced tool, with images and PDFs as content blocks", async () => {
    const m = await load({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: KEY });
    replies = [{ content: [{ type: "tool_use", id: "toolu_1", name: "briefing", input: { summary: "All lines running." } }], stop_reason: "tool_use" }];
    const r = await m.llmGenerate({ prompt: "Summarise.", media: [{ mimeType: "image/png", data: "AAAA" }, { mimeType: "application/pdf", data: "BBBB" }], json: { name: "briefing", schema } });
    expect(r.json).toEqual({ summary: "All lines running." });
    expect(r.model).toBe("claude-sonnet-5-5 via Anthropic API");
    const { url, body, headers } = calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(body.tool_choice).toEqual({ type: "tool", name: "briefing" });
    const content = (body.messages as { content: { type: string }[] }[])[0].content.map((c) => c.type);
    expect(content).toEqual(["image", "document", "text"]);
  });

  it("cites web sources and refuses video", async () => {
    const m = await load({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: KEY });
    replies = [
      {
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "PET bottling line layout" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
          { type: "text", text: "Fillers run 6,000–24,000 bottles per hour.", citations: [{ type: "web_search_result_location", url: "https://example.com/a", title: "Bottling basics" }] },
          { type: "text", text: " Labelers follow the capper." },
        ],
        stop_reason: "end_turn",
      },
    ];
    const r = await m.llmGenerate({ prompt: "Research bottling.", webSearch: true });
    expect(r.citations).toEqual([{ id: "R1", url: "https://example.com/a", title: "Bottling basics" }]);
    expect(r.markedText).toBe("Fillers run 6,000–24,000 bottles per hour. [R1] Labelers follow the capper.");
    expect(r.queries).toEqual(["PET bottling line layout"]);
    expect((calls[0].body.tools as { type?: string }[])[0].type).toBe("web_search_20250305");
    await expect(m.llmGenerate({ prompt: "Watch.", media: [{ mimeType: "video/mp4", data: "CCCC" }] })).rejects.toBeInstanceOf(m.AiUnsupported);
  });
});

describe("OpenAI (Responses API)", () => {
  it("returns JSON and inserts citation markers from annotations", async () => {
    const m = await load({ AI_PROVIDER: "openai", OPENAI_API_KEY: KEY });
    replies = [{ output: [{ type: "message", content: [{ type: "output_text", text: '{"summary":"ok"}', annotations: [] }] }] }];
    const r = await m.llmGenerate({ prompt: "Summarise.", media: [{ mimeType: "image/jpeg", data: "AAAA" }], json: { name: "briefing", schema } });
    expect(r.json).toEqual({ summary: "ok" });
    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect((calls[0].body.text as { format: { type: string } }).format.type).toBe("json_schema");
    const input = calls[0].body.input as { content: { type: string; image_url?: string }[] }[];
    expect(input[0].content[0]).toEqual({ type: "input_image", image_url: "data:image/jpeg;base64,AAAA" });

    replies = [
      {
        output: [
          { type: "web_search_call", action: { query: "bakery line" } },
          { type: "message", content: [{ type: "output_text", text: "Ovens bake 2 t/h.", annotations: [{ type: "url_citation", url: "https://example.com/b", title: "Ovens", end_index: 16 }] }] },
        ],
      },
    ];
    const s = await m.llmGenerate({ prompt: "Research.", webSearch: true });
    expect(s.markedText).toBe("Ovens bake 2 t/h [R1].");
    expect(s.queries).toEqual(["bakery line"]);
  });
});

describe("OpenAI-compatible endpoints (Chat Completions)", () => {
  it("asks for JSON, maps tool calls and says what it can't do", async () => {
    const m = await load({ AI_PROVIDER: "openai-compatible", OPENAI_BASE_URL: "https://openrouter.ai/api/v1", OPENAI_MODEL: "some/model", OPENAI_API_KEY: KEY });
    replies = [{ choices: [{ message: { content: '```json\n{"summary":"fine"}\n```' } }] }];
    const r = await m.llmGenerate({ prompt: "Summarise.", json: { name: "briefing", schema } });
    expect(r.json).toEqual({ summary: "fine" });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
    expect(String((calls[0].body.messages as { content: string }[])[0].content)).toContain("JSON Schema");
    await expect(m.llmGenerate({ prompt: "Research.", webSearch: true })).rejects.toThrow(/Web search isn't available/);
    await expect(m.llmGenerate({ prompt: "Read.", media: [{ mimeType: "application/pdf", data: "AA" }] })).rejects.toBeInstanceOf(m.AiUnsupported);
  });
});

describe("ADK model adapter (copilot on Claude / OpenAI)", () => {
  it("translates Gemini contents, schemas and function calls both ways", async () => {
    const m = await load({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: KEY });
    const { ProviderLlm, toJsonSchema, toMessages } = await import("@/server/copilot/provider-llm");
    expect(toJsonSchema({ type: "OBJECT", properties: { assetId: { type: "STRING", nullable: true }, hours: { type: "INTEGER", minimum: 1 } }, required: ["hours"] })).toEqual({
      type: "object",
      properties: { assetId: { type: ["string", "null"] }, hours: { type: "integer", minimum: 1 } },
      required: ["hours"],
    });
    const msgs = toMessages([
      { role: "user", parts: [{ text: "Why is Line A rejecting boards?" }] },
      { role: "model", parts: [{ functionCall: { name: "quality_analyst", args: { request: "explain rejects" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "quality_analyst", response: { result: "robot A3" } } }] },
    ]);
    const call = msgs[1].parts[0] as { type: string; id: string };
    const result = msgs[2].parts[0] as { type: string; id: string };
    expect(call.type).toBe("tool_call");
    expect(result).toMatchObject({ type: "tool_result", id: call.id });

    replies = [{ content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_9", name: "get_plant_overview", input: {} }], stop_reason: "tool_use" }];
    const llm = new ProviderLlm(m.aiConfig());
    const out = [];
    for await (const r of llm.generateContentAsync({
      contents: [{ role: "user", parts: [{ text: "Overview?" }] }],
      config: { systemInstruction: "You are TwinForge Copilot.", tools: [{ functionDeclarations: [{ name: "get_plant_overview", description: "Plant overview", parameters: { type: "OBJECT", properties: {} } }] }] },
      liveConnectConfig: {},
      toolsDict: {},
    } as never))
      out.push(r);
    expect(out[0].content?.parts).toEqual([{ text: "Checking." }, { functionCall: { id: "toolu_9", name: "get_plant_overview", args: {} } }]);
    expect(calls[0].body.system).toBe("You are TwinForge Copilot.");
    expect((calls[0].body.tools as { name: string; input_schema: { type: string } }[])[0]).toMatchObject({ name: "get_plant_overview", input_schema: { type: "object" } });
  });
});
