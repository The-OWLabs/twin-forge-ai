import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { AgentTool, FunctionTool, Gemini, InMemorySessionService, LlmAgent, Runner, getFunctionCalls, getFunctionResponses, type BaseTool, type Event } from "@google/adk";
import { checkGrounding } from "@/domain/tools/grounding";
import { callTwinTool, TWIN_TOOLS, type TwinToolName } from "@/domain/tools/twin-tools";
import { aiConfig } from "@/server/ai/provider";
import { serverToolStore } from "@/server/tools/store";
import { objectSchema } from "./schema";

/**
 * TwinForge Copilot: a multi-agent system on Google's Agent Development Kit (ADK, TypeScript).
 *
 *   twinforge_copilot (coordinator)
 *     ├─ maintenance_analyst  → list_assets, diagnose_asset, list_incidents, get_latest_analysis
 *     ├─ quality_analyst      → get_quality, get_camera_view
 *     ├─ planning_analyst     → get_orders, get_inventory, run_what_if
 *     └─ get_plant_overview, search_audit, propose_plan (ADK confirmation gate)
 *
 * Every tool is a deterministic TwinForge function; the model explains, it never computes the
 * numbers. Answers are checked for figures that cannot be traced to a tool result.
 */

export const ACTOR = "TwinForge Copilot (ADK)";
const APP = "twinforge";
const USER = "operator";

export type CopilotEvent =
  | { type: "start"; sessionId: string }
  | { type: "agent"; agent: string; text: string }
  | { type: "tool_call"; agent: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; agent: string; tool: string; ok: boolean; preview: string }
  | { type: "confirm"; callId: string; tool: string; args: Record<string, unknown>; hint: string }
  | { type: "answer"; text: string; grounding: { figures: number; unverified: string[]; derived: string[] } }
  | { type: "error"; message: string }
  | { type: "done" };

/** Per-request sink so sub-agent tool calls (which run in their own runner) reach the stream. */
const sink = new AsyncLocalStorage<{ emit: (e: CopilotEvent) => void; results: unknown[] }>();

const SPECIALIST_RULES = [
  "Use your tools to answer. Report only figures that appear in tool results, with their units; never estimate or invent numbers.",
  "Keep ids (asset, order, camera ids) exactly as the tools return them. Times are relative to now (h+N).",
  "The data comes from a deterministic plant model with simulated demo data; say 'estimate' for forecasts.",
  "Reply in at most 6 short bullet points for the coordinator. Do not address the end user.",
].join("\n");

function fnTool(name: TwinToolName) {
  const t = TWIN_TOOLS.find((x) => x.name === name)!;
  return new FunctionTool({
    name: t.name,
    description: t.description,
    parameters: objectSchema(t.shape),
    requireConfirmation: t.effect === "propose",
    execute: (args: unknown) => {
      const ctx = sink.getStore();
      try {
        const result = callTwinTool(serverToolStore, t.name, args, ACTOR);
        ctx?.results.push(result);
        return { result };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}

function preview(v: unknown) {
  const s = JSON.stringify(v) ?? "";
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
}

/** Stream specialist tool activity (inner runner) to the current request. */
const beforeTool = ({ tool, args, context }: { tool: BaseTool; args: Record<string, unknown>; context: { agentName?: string } }) => {
  sink.getStore()?.emit({ type: "tool_call", agent: context.agentName ?? "specialist", tool: tool.name, args });
  return undefined;
};
const afterTool = ({ tool, response, context }: { tool: BaseTool; response: Record<string, unknown>; context: { agentName?: string } }) => {
  sink.getStore()?.emit({ type: "tool_result", agent: context.agentName ?? "specialist", tool: tool.name, ok: !("error" in (response ?? {})), preview: preview(response) });
  return undefined;
};

function buildCopilot() {
  const cfg = aiConfig();
  const model =
    cfg.provider === "vertex"
      ? new Gemini({ model: cfg.model, vertexai: true, project: cfg.project, location: cfg.location })
      : new Gemini({ model: cfg.model, apiKey: process.env.GEMINI_API_KEY });
  const gen = { temperature: 0.2, maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "LOW" as never } };
  const specialist = (name: string, description: string, focus: string, tools: TwinToolName[]) =>
    new LlmAgent({
      name,
      description,
      model,
      instruction: `${focus}\n${SPECIALIST_RULES}`,
      tools: tools.map(fnTool),
      generateContentConfig: gen,
      beforeToolCallback: beforeTool as never,
      afterToolCallback: afterTool as never,
    });

  const maintenance = specialist(
    "maintenance_analyst",
    "Diagnoses machine condition: health, vibration and temperature trends, time to alarm or trip, incidents and the last multi-agent analysis.",
    "You are the maintenance analyst for a factory digital twin. Find the machines at risk and explain their condition with evidence.",
    ["list_assets", "diagnose_asset", "list_incidents", "get_latest_analysis"],
  );
  const quality = specialist(
    "quality_analyst",
    "Explains inspection results: first-pass yield, reject rates, defect Pareto, camera views, and links between machine condition and rejects.",
    "You are the quality analyst. Explain what the inspection stations and cameras show and what is driving rejects.",
    ["get_quality", "get_camera_view"],
  );
  const planning = specialist(
    "planning_analyst",
    "Evaluates delivery risk and operating plans: customer orders, inventory coverage, and what-if simulation of maintenance, speed and reroute options.",
    "You are the planning analyst. Use what-if simulation to compare plans; state the ranking and the trade-offs in delivery, cost and risk.",
    ["get_orders", "get_inventory", "run_what_if"],
  );

  return new LlmAgent({
    name: "twinforge_copilot",
    description: "Coordinator for the TwinForge industrial digital twin.",
    model,
    instruction: [
      "You are TwinForge Copilot, the operations assistant for an industrial digital twin. You coordinate three specialists (maintenance_analyst, quality_analyst, planning_analyst) and have your own tools.",
      "Ground every answer in tool results: call get_plant_overview for general questions and delegate to the specialists for diagnosis, quality and planning. Do not answer factual questions from memory.",
      "Report only figures that appear in tool or specialist results. Never invent or estimate numbers yourself. If something is unknown, say so.",
      "The twin runs on a deterministic plant model with simulated demo data. Forecasts are model estimates.",
      "You cannot control equipment, approve, execute or roll back anything. If the user explicitly asks to propose or submit a plan, call propose_plan; it pauses for the user's confirmation and then creates a pending recommendation that a person must approve in Approvals. Never call propose_plan unprompted.",
      "Answer concisely in plain language: a one-line answer first, then up to 5 bullets with the key evidence (with ids and units). Use h+N for times.",
    ].join("\n"),
    tools: [fnTool("get_plant_overview"), fnTool("search_audit"), fnTool("propose_plan"), new AgentTool({ agent: maintenance }), new AgentTool({ agent: quality }), new AgentTool({ agent: planning })],
    generateContentConfig: gen,
  });
}

const g = globalThis as unknown as {
  __twinforgeCopilot?: { runner: Runner; sessions: InMemorySessionService; model: string; busy: Set<string>; evidence: Map<string, unknown[]> };
};

function copilot() {
  const cfg = aiConfig();
  if (cfg.provider === "none") return null;
  if (!g.__twinforgeCopilot || g.__twinforgeCopilot.model !== cfg.model) {
    const sessions = new InMemorySessionService();
    g.__twinforgeCopilot = { runner: new Runner({ appName: APP, agent: buildCopilot(), sessionService: sessions }), sessions, model: cfg.model, busy: new Set(), evidence: new Map() };
  }
  return g.__twinforgeCopilot;
}

export function copilotInfo() {
  const cfg = aiConfig();
  return {
    available: cfg.provider !== "none",
    model: cfg.provider === "none" ? null : cfg.model,
    framework: "Google Agent Development Kit (TypeScript)",
    agents: [
      { name: "twinforge_copilot", role: "Coordinator", tools: ["get_plant_overview", "search_audit", "propose_plan (needs your confirmation)"] },
      { name: "maintenance_analyst", role: "Machine condition", tools: ["list_assets", "diagnose_asset", "list_incidents", "get_latest_analysis"] },
      { name: "quality_analyst", role: "Inspection and cameras", tools: ["get_quality", "get_camera_view"] },
      { name: "planning_analyst", role: "Orders, inventory and what-if", tools: ["get_orders", "get_inventory", "run_what_if"] },
    ],
  };
}

export type CopilotInput = { sessionId: string; message?: string; confirm?: { callId: string; confirmed: boolean } };

/** Run one copilot turn and stream its events. */
export async function* runCopilot(input: CopilotInput): AsyncGenerator<CopilotEvent> {
  const c = copilot();
  if (!c) {
    yield { type: "error", message: "The copilot needs Gemini (Vertex AI), which is not configured on this server. The MCP tools still work without it." };
    return;
  }
  if (c.busy.has(input.sessionId)) {
    yield { type: "error", message: "The copilot is still answering your previous message." };
    return;
  }
  c.busy.add(input.sessionId);
  const queue: CopilotEvent[] = [];
  let wake: (() => void) | null = null;
  const emit = (e: CopilotEvent) => {
    queue.push(e);
    wake?.();
  };
  // Tool results from the whole conversation: answers may cite figures fetched in earlier turns.
  const results: unknown[] = c.evidence.get(input.sessionId) ?? [];
  if (input.message) results.push(input.message);
  c.evidence.set(input.sessionId, results);
  if (c.evidence.size > 200) c.evidence.delete(c.evidence.keys().next().value!);
  let finished = false;

  const work = sink.run({ emit, results }, async () => {
    try {
      const existing = await c.sessions.getSession({ appName: APP, userId: USER, sessionId: input.sessionId });
      if (!existing) await c.sessions.createSession({ appName: APP, userId: USER, sessionId: input.sessionId });
      emit({ type: "start", sessionId: input.sessionId });
      const newMessage = input.confirm
        ? { role: "user", parts: [{ functionResponse: { id: input.confirm.callId, name: "adk_request_confirmation", response: { confirmed: input.confirm.confirmed } } }] }
        : { role: "user", parts: [{ text: input.message ?? "" }] };
      let answer = "";
      for await (const ev of c.runner.runAsync({ userId: USER, sessionId: input.sessionId, newMessage }) as AsyncGenerator<Event>) {
        if (ev.errorMessage) emit({ type: "error", message: ev.errorMessage });
        for (const call of getFunctionCalls(ev)) {
          if (call.name === "adk_request_confirmation") {
            const a = (call.args ?? {}) as { originalFunctionCall?: { name?: string; args?: Record<string, unknown> }; toolConfirmation?: { hint?: string } };
            emit({ type: "confirm", callId: call.id ?? "", tool: a.originalFunctionCall?.name ?? "propose_plan", args: a.originalFunctionCall?.args ?? {}, hint: a.toolConfirmation?.hint || "Create a pending recommendation for a person to approve?" });
          } else {
            emit({ type: "tool_call", agent: ev.author ?? "twinforge_copilot", tool: call.name ?? "?", args: (call.args ?? {}) as Record<string, unknown> });
          }
        }
        for (const resp of getFunctionResponses(ev)) {
          if (resp.name === "adk_request_confirmation") continue;
          // Only deterministic tool outputs (captured in execute) count as grounding sources;
          // a specialist's own text (AgentTool response) does not.
          const r = (resp.response ?? {}) as Record<string, unknown>;
          emit({ type: "tool_result", agent: ev.author ?? "twinforge_copilot", tool: resp.name ?? "?", ok: !("error" in r), preview: preview(r) });
        }
        const text = (ev.content?.parts ?? [])
          .filter((p) => typeof p.text === "string" && !p.thought)
          .map((p) => p.text)
          .join("");
        if (text && !ev.partial && ev.author === "twinforge_copilot") answer = text;
      }
      if (results.length > 400) results.splice(0, results.length - 400);
      if (answer) emit({ type: "answer", text: answer, grounding: checkGrounding(answer, results) });
    } catch (e) {
      emit({ type: "error", message: e instanceof Error ? e.message.slice(0, 400) : String(e) });
    } finally {
      finished = true;
      wake?.();
    }
  });

  try {
    while (!finished || queue.length) {
      if (!queue.length) await new Promise<void>((r) => (wake = r));
      wake = null;
      while (queue.length) yield queue.shift()!;
    }
    await work;
    yield { type: "done" };
  } finally {
    c.busy.delete(input.sessionId);
  }
}
