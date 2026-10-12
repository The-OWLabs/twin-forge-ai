import { commitAnalysis, runAnalysisPipeline, type PipelineEvent } from "@/domain/agents/pipeline";
import { generateNarrative } from "@/server/ai/provider";
import { json, nowISO } from "@/server/http";
import { mirrorScenarioRun } from "@/server/integrations/status";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const g = globalThis as unknown as { __twinforgeAnalysis?: { running: boolean } };
const lock = (g.__twinforgeAnalysis ??= { running: false });

/**
 * Runs the multi-agent investigation on a snapshot of the factory and streams every
 * intermediate result as NDJSON. The final bundle is committed to the live state.
 */
export async function POST(req: Request) {
  if (lock.running) return json({ error: "An analysis is already running" }, 409);
  const fast = new URL(req.url).searchParams.get("fast") === "1";
  const snapshot = structuredClone(getState());
  lock.running = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: PipelineEvent | { type: "committed"; state: unknown } | { type: "discarded"; reason: string }) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client disconnected — keep computing so the result is still committed */
        }
      };
      try {
        const gen = runAnalysisPipeline(snapshot, {
          nowISO,
          pace: (ms) => (fast ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))),
          narrate: generateNarrative,
        });
        let step = await gen.next();
        while (!step.done) {
          send(step.value);
          step = await gen.next();
        }
        const bundle = step.value;
        const live = getState();
        if (live.profile.id !== snapshot.profile.id || live.clock.tick < snapshot.clock.tick) {
          send({ type: "discarded", reason: "Factory was reset during analysis; results were not committed." });
        } else {
          mutate((s) => commitAnalysis(s, bundle, nowISO()));
          if (bundle.scenarioRun) void mirrorScenarioRun(bundle.scenarioRun, live.profile.id);
          send({ type: "committed", state: getState() });
        }
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        lock.running = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
