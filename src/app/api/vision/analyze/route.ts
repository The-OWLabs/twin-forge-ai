import { DomainError } from "@/domain/actions";
import { getCamera } from "@/domain/vision";
import { json, route } from "@/server/http";
import { getState } from "@/server/store";
import { geminiReview } from "@/server/vision/reviews";

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
  const out = await geminiReview({ bytes: Buffer.from(await file.arrayBuffer()), mime: file.type || "application/octet-stream", fileName: file.name, camera });
  if (!out.ok) return json({ error: out.error }, out.status);
  return json(out.value, 201);
});
