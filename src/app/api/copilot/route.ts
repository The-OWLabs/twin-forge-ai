import { z } from "zod";
import { copilotInfo, runCopilot, type CopilotEvent } from "@/server/copilot/agent";
import { json, parseBody, route } from "@/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = route(() => json(copilotInfo()));

const Body = z
  .object({
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    message: z.string().trim().min(1).max(2000).optional(),
    confirm: z.object({ callId: z.string().min(1).max(200), confirmed: z.boolean() }).optional(),
  })
  .refine((b) => !!b.message !== !!b.confirm, "Send either a message or a confirmation");

/** One copilot turn (ADK multi-agent), streamed as NDJSON: tool calls, results, confirmations, answer. */
export const POST = route(async (req: Request) => {
  const body = await parseBody(req, Body);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: CopilotEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        for await (const e of runCopilot(body)) send(e);
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});
