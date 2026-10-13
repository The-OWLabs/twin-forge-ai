import { DomainError } from "@/domain/actions";
import { nextId } from "@/domain/ids";
import { addVisionReview, findingsFromInspection, getCamera, type InspectionResult } from "@/domain/vision";
import { json, nowISO, route } from "@/server/http";
import { recordCheck } from "@/server/integrations/status";
import { inspectWithService, visionService, VisionServiceError } from "@/server/integrations/vision-service";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"]);
const MB = 1024 * 1024;
const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
};

/** Browsers report some types inconsistently (e.g. "video/avi" or "" for .avi); fall back to the extension. */
function normalised(f: File): File {
  if (IMAGE_TYPES.has(f.type) || VIDEO_TYPES.has(f.type)) return f;
  const type = BY_EXTENSION[f.name.split(".").pop()?.toLowerCase() ?? ""];
  return type ? new File([f], f.name, { type }) : f;
}

/**
 * Machine-vision check on the Python vision service (OpenCV). Multipart fields: `file` (image or
 * video), optional `reference` (golden image, images only) and `cameraId`. The result is stored as
 * a visual review pending human disposition.
 */
export const POST = route(async (req: Request) => {
  if (!visionService.configured()) {
    return json({ error: "The vision service is not configured. Run services/vision and set VISION_SERVICE_URL (see docs/python-services-plan.md)." }, 503);
  }
  const form = await req.formData().catch(() => {
    throw new DomainError("Expected multipart form data with a 'file' field");
  });
  const rawFile = form.get("file");
  const rawReference = form.get("reference");
  const file = rawFile instanceof File ? normalised(rawFile) : rawFile;
  const reference = rawReference instanceof File ? normalised(rawReference) : rawReference;
  const cameraId = (form.get("cameraId") as string | null) || null;
  if (!(file instanceof File)) throw new DomainError("Missing 'file'");
  const camera = cameraId ? getCamera(getState(), cameraId) : null;

  const kind = IMAGE_TYPES.has(file.type) ? "image" : VIDEO_TYPES.has(file.type) ? "video" : null;
  if (!kind) return json({ error: `Unsupported file type ${file.type || "unknown"}. Use JPEG, PNG, WebP, BMP, MP4, WebM, MOV or AVI.` }, 415);
  if (file.size > (kind === "image" ? 15 : 30) * MB) return json({ error: `File is larger than ${kind === "image" ? 15 : 30} MB.` }, 413);
  const out = new FormData();
  out.append(kind, file, file.name);
  if (reference instanceof File && reference.size > 0) {
    if (kind !== "image") throw new DomainError("A golden reference can only be used with an image");
    if (!IMAGE_TYPES.has(reference.type)) return json({ error: `Unsupported reference type ${reference.type}.` }, 415);
    if (reference.size > 15 * MB) return json({ error: "Reference image is larger than 15 MB." }, 413);
    out.append("reference", reference, reference.name);
  }

  let result: InspectionResult;
  let latencyMs: number;
  try {
    ({ data: result, latencyMs } = await inspectWithService<InspectionResult>(kind, out));
  } catch (e) {
    if (e instanceof VisionServiceError) {
      if (e.status >= 500) recordCheck("vision-service", false, e.message);
      return json({ error: e.message }, e.status);
    }
    throw e;
  }
  recordCheck("vision-service", true, `${visionService.url()} · ${result.engine} · last inspection ${latencyMs} ms`);

  const { summary, findings } = findingsFromInspection(result);
  const at = nowISO();
  const review = mutate((s) => {
    const r = {
      id: nextId(s, "VR", 900),
      cameraId: camera?.id ?? null,
      at,
      hour: s.clock.hour,
      source: "opencv" as const,
      model: `${result.engine} · vision service`,
      fileName: [file.name, reference instanceof File && reference.size > 0 ? `vs ${reference.name}` : null].filter(Boolean).join(" ").slice(0, 160),
      summary,
      findings,
      disposition: "pending-human-review" as const,
      note: "",
    };
    addVisionReview(s, r, "Vision service (OpenCV)", at);
    return r;
  });
  return json({ review, result, state: getState() }, 201);
});
