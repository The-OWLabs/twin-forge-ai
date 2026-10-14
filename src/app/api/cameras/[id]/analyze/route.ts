import { DomainError } from "@/domain/actions";
import { getClip } from "@/domain/footage";
import { getCamera } from "@/domain/vision";
import { json, parseBody, route } from "@/server/http";
import { CameraAnalyzeSchema } from "@/server/schemas";
import { getState } from "@/server/store";
import { geminiReview, opencvInspect, readFootage } from "@/server/vision/reviews";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Run visual QA on what a camera is currently showing. Works on reference footage (the clip is
 * on this server); gateway streams are analysed at the edge, not here. The review records that
 * the video is reference footage from another facility.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { engine } = await parseBody(req, CameraAnalyzeSchema);
  const camera = getCamera(getState(), id);
  if (camera.stream.kind !== "footage" || !camera.stream.clipId) {
    throw new DomainError(
      camera.stream.kind === "simulated"
        ? "This camera shows the twin-rendered feed. Switch it to reference footage in the control room to run visual QA on real video."
        : "Gateway streams are analysed by the edge worker on the plant network (see docs/python-services-plan.md, Phase 3), not by this server.",
      409,
    );
  }
  const clip = getClip(camera.stream.clipId);
  if (!clip) throw new DomainError(`Footage clip ${camera.stream.clipId} not found`, 404);
  const bytes = await readFootage(clip);
  const fileName = `${clip.id}.mp4 (reference footage)`;
  const note = `Reference footage "${clip.title}" by ${clip.source.author} (${clip.source.site}, ${clip.source.license}). Real video from another facility, not this plant.`;
  const out =
    engine === "gemini"
      ? await geminiReview({
          bytes,
          mime: "video/mp4",
          fileName,
          camera,
          note,
          context: `The clip is reference footage of a comparable facility (${clip.shows}). Describe only what is visible in it`,
        })
      : await opencvInspect({ kind: "video", file: new File([new Uint8Array(bytes)], `${clip.id}.mp4`, { type: "video/mp4" }), camera, note, fileName });
  if (!out.ok) return json({ error: out.error }, out.status);
  return json(out.value, 201);
});
