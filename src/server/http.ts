import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { DomainError } from "@/domain/actions";

export const nowISO = () => new Date().toISOString();

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(e: unknown) {
  if (e instanceof DomainError) return json({ error: e.message }, e.status);
  if (e instanceof ZodError) {
    return json({ error: "Invalid request", issues: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) }, 400);
  }
  if (e instanceof SyntaxError) return json({ error: "Malformed JSON body" }, 400);
  console.error("[api] unexpected error", e);
  return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<output<S>> {
  const text = await req.text();
  const raw = text.trim() ? JSON.parse(text) : {};
  return schema.parse(raw);
}

/** Wrap a route handler with uniform error handling. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
