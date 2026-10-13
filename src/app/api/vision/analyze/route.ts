import { DomainError } from "@/domain/actions";
import { nextId } from "@/domain/ids";
import { addVisionReview, getCamera, VISION_CATEGORIES } from "@/domain/vision";
import { analyzeMedia } from "@/server/ai/provider";
import { json, nowISO, route } from "@/server/http";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Upload a short clip or image for Gemini to review (advisory; pending human disposition). */
export const POST = route(async (req: Request) => {
  const form = await req.formData().catch(() => {
    throw new DomainError("Expected multipart form data with a 'file' field");
  });
  const file = form.get("file");
  const cameraId = (form.get("cameraId") as string | null) || null;
  if (!(file instanceof File)) throw new DomainError("Missing 'file'");
  const camera = cameraId ? getCamera(getState(), cameraId) : null;
  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await analyzeMedia(bytes, file.type || "application/octet-stream", {
    station: camera ? `${camera.name} (${camera.purpose})` : "Unspecified station",
    standard: camera?.standard ?? null,
    categories: VISION_CATEGORIES,
  });
  if (!result.ok) return json({ error: result.error }, result.status);
  const at = nowISO();
  const review = mutate((s) => {
    const r = {
      id: nextId(s, "VR", 900),
      cameraId: camera?.id ?? null,
      at,
      hour: s.clock.hour,
      source: "gemini" as const,
      model: result.analysis.model,
      fileName: file.name.slice(0, 120),
      summary: result.analysis.summary,
      findings: result.analysis.findings,
      disposition: "pending-human-review" as const,
      note: "",
    };
    addVisionReview(s, r, `Gemini (${result.analysis.model})`, at);
    return r;
  });
  return json({ review, state: getState() }, 201);
});
