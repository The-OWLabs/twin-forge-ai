import { setCameraStream } from "@/domain/vision";
import { json, nowISO, parseBody, route } from "@/server/http";
import { CameraStreamSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

/** Configure a camera's stream source (simulated, or an HLS / MP4 / MJPEG gateway URL). */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { kind, url, by } = await parseBody(req, CameraStreamSchema);
  const camera = mutate((s) => setCameraStream(s, id, { kind, url }, by, nowISO()));
  return json({ camera, state: getState() });
});
