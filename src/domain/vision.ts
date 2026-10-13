/** Camera configuration, access logging and visual-review records. */
import { DomainError } from "./actions";
import { appendAudit } from "./audit";
import { nextId } from "./ids";
import { round } from "./math";
import { inspectionFrames } from "./quality";
import type { Camera, FactoryState, VisionFinding, VisionReview } from "./types";

/** Categories offered to the vision model and used in reviews (keeps findings comparable). */
export const VISION_CATEGORIES = [
  "Component misalignment / skew",
  "Missing component",
  "Tombstoning",
  "Solder bridging",
  "Insufficient solder",
  "Lifted lead",
  "Solder balls",
  "Polarity error",
  "Press-fit pin damage",
  "Incomplete press-fit seating",
  "Handling damage / scratches",
  "Barcode grade below C",
  "Label skew / missing",
  "Carton seal open",
  "Seal burn / film damage",
  "Count mismatch",
  "Process: jam or stoppage",
  "Safety: PPE not visible (advisory)",
  "Safety: person in restricted zone (advisory)",
  "Housekeeping: spill or obstruction",
  "Deviation from golden reference",
  "Image not usable for inspection",
  "Code read",
  "Line motion stopped",
  "No defect visible",
  "Other",
] as const;

const MAJOR = new Set(["Component misalignment / skew", "Missing component", "Polarity error", "Press-fit pin damage", "Incomplete press-fit seating", "Carton seal open", "Count mismatch"]);

export function getCamera(state: FactoryState, id: string): Camera {
  const cam = state.cameras.find((c) => c.id === id);
  if (!cam) throw new DomainError(`Camera ${id} not found`, 404);
  return cam;
}

/** Point a camera at a real stream served by a plant-side gateway (HLS / MP4 / MJPEG over HTTPS). */
export function setCameraStream(state: FactoryState, id: string, stream: Camera["stream"], by: string, nowISO: string) {
  const cam = getCamera(state, id);
  if (stream.kind !== "simulated") {
    if (!stream.url) throw new DomainError("A stream URL is required");
    let u: URL;
    try {
      u = new URL(stream.url);
    } catch {
      throw new DomainError("Stream URL is not a valid URL");
    }
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new DomainError("Stream URL must use https:// (or http://localhost for testing) — browsers block insecure video on a secure page");
  }
  cam.stream = stream.kind === "simulated" ? { kind: "simulated", url: null } : { kind: stream.kind, url: stream.url };
  appendAudit(state, nowISO, {
    category: "asset",
    actor: by,
    title: `Camera ${cam.id} stream ${stream.kind === "simulated" ? "set to simulated feed" : `set to ${stream.kind.toUpperCase()} gateway`}`,
    detail: stream.kind === "simulated" ? "Using the twin-generated feed." : `Source host: ${new URL(stream.url!).host}`,
    severity: "info",
    refs: { assetIds: cam.assetId ? [cam.assetId] : [] },
  });
  return cam;
}

/** Every live view is logged — accountability for workplace video (purpose limitation, access audit). */
export function logCameraView(state: FactoryState, id: string, by: string, nowISO: string) {
  const cam = getCamera(state, id);
  appendAudit(state, nowISO, {
    category: "system",
    actor: by,
    title: `Live view opened: ${cam.id}`,
    detail: `${cam.name} · ${cam.stream.kind === "simulated" ? "simulated feed" : `${cam.stream.kind.toUpperCase()} stream`} · purpose: ${cam.purpose}`,
    severity: "info",
    refs: { assetIds: cam.assetId ? [cam.assetId] : [] },
  });
}

/**
 * Review the inspection log of a simulated inspection camera: replays the most recent units the
 * station inspected (derived from the plant model) and lists every reject. Deterministic.
 */
export function reviewInspectionLog(state: FactoryState, id: string, nowISO: string, units = 60): VisionReview {
  const cam = getCamera(state, id);
  if (cam.kind !== "inspection") throw new DomainError("Inspection-log review is available for inspection cameras only");
  const frames = inspectionFrames(state, cam, units);
  const recs = state.production.filter((r) => r.lineId === cam.lineId && r.hour >= Math.floor(state.clock.hour) - 1);
  const insp = recs.reduce((s, r) => s + r.goodUnits + r.scrapUnits, 0);
  const secPerUnit = insp > 0 ? 3600 / Math.max(1, insp / Math.max(0.1, recs.length)) : 30;
  const findings: VisionFinding[] = frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !f.pass && f.defect)
    .map(({ f, i }) => ({
      timestampSec: round(i * secPerUnit, 0),
      category: f.defect!.type,
      description: `Unit #${f.unit}: ${f.defect!.type} — fails ${f.defect!.criterion} (Class 2).`,
      severity: MAJOR.has(f.defect!.type) ? ("major" as const) : ("minor" as const),
      confidence: 1,
    }));
  const review: VisionReview = {
    id: nextId(state, "VR", 900),
    cameraId: cam.id,
    at: nowISO,
    hour: state.clock.hour,
    source: "simulated-inspection-log",
    fileName: null,
    summary: `${frames.length} most recent units at ${cam.id}: ${findings.length} rejected${findings.length ? ` (${[...new Set(findings.map((x) => x.category))].join(", ")})` : ""}. Derived from the simulated inspection model.`,
    findings,
    disposition: "pending-human-review",
    note: "",
  };
  addVisionReview(state, review, "Quality Inspection Agent", nowISO);
  return review;
}

export function addVisionReview(state: FactoryState, review: VisionReview, actor: string, nowISO: string) {
  state.visionReviews.unshift(review);
  state.visionReviews = state.visionReviews.slice(0, 30);
  appendAudit(state, nowISO, {
    category: "agent",
    actor,
    title: `Visual review ${review.id}: ${review.findings.filter((f) => f.category !== "No defect visible").length} finding(s)`,
    detail: `${review.summary} Awaiting human disposition.`,
    severity: review.findings.some((f) => f.severity === "major" || f.severity === "critical") ? "warning" : "info",
    refs: {},
  });
}

export function dispositionReview(state: FactoryState, id: string, disposition: "confirmed" | "dismissed", note: string, by: string, nowISO: string) {
  const r = state.visionReviews.find((x) => x.id === id);
  if (!r) throw new DomainError(`Review ${id} not found`, 404);
  if (r.disposition !== "pending-human-review") throw new DomainError(`Review ${id} was already ${r.disposition}`, 409);
  r.disposition = disposition;
  r.note = note;
  appendAudit(state, nowISO, {
    category: disposition === "confirmed" ? "approval" : "rejection",
    actor: by,
    title: `${disposition === "confirmed" ? "Confirmed" : "Dismissed"} visual review ${r.id}`,
    detail: `${r.findings.length} finding(s) from ${r.source === "gemini" ? `Gemini (${r.model ?? "model"})` : "simulated inspection log"}.${note ? ` Note: "${note}"` : ""}`,
    severity: disposition === "confirmed" ? "success" : "info",
    refs: {},
  });
  return r;
}

/* ───────────────────────────── vision service (OpenCV) results ───────────────────────────── */

type NBox = { x: number; y: number; w: number; h: number };

export interface ServiceCode {
  format: string;
  data: string;
  box?: NBox;
  symbolContrast?: number | null;
  contrastGrade: string | null;
  firstSec?: number;
}

export interface ImageInspectionResult {
  kind: "image";
  width: number;
  height: number;
  quality: { sharpness: number; brightness: number; contrast: number; usable: boolean; issues: string[] };
  codes: ServiceCode[];
  comparison: {
    alignment: "homography" | "resize";
    alignmentNote: string;
    inliers: number;
    threshold: number;
    minAreaPct: number;
    changedPct: number;
    defects: { box: NBox; areaPct: number; meanDiff: number }[];
    truncated: boolean;
  } | null;
  engine: string;
  durationMs: number;
}

export interface VideoInspectionResult {
  kind: "video";
  fps: number;
  durationSec: number;
  analysedSec: number;
  truncated: boolean;
  sampleFps: number;
  framesAnalysed: number;
  motionThresholdPct: number;
  movingPct: number;
  segments: { state: "moving" | "still"; startSec: number; endSec: number }[];
  stillPeriods: { startSec: number; endSec: number; durationSec: number }[];
  quality: { blurryFrames: number; underexposedFrames: number; overexposedFrames: number };
  codes: ServiceCode[];
  series: { t: number; changedPct: number }[];
  engine: string;
  durationMs: number;
}

export type InspectionResult = ImageInspectionResult | VideoInspectionResult;

const pctText = (v: number) => `${v < 0.1 ? v.toFixed(2) : v.toFixed(1)}%`;
const LOW_GRADES = new Set(["D", "F"]);

/** Turn a deterministic OpenCV result into review findings (confidence 1 = measured, not predicted). */
export function findingsFromInspection(r: InspectionResult): { summary: string; findings: VisionFinding[] } {
  const findings: VisionFinding[] = [];
  const codeFinding = (c: ServiceCode): VisionFinding => {
    const low = !!c.contrastGrade && LOW_GRADES.has(c.contrastGrade);
    return {
      timestampSec: c.firstSec ?? null,
      category: low && c.format !== "QR_CODE" ? "Barcode grade below C" : "Code read",
      description: `${c.format} "${c.data}"${c.contrastGrade ? ` · indicative symbol-contrast grade ${c.contrastGrade}${c.symbolContrast != null ? ` (${c.symbolContrast}%)` : ""}` : ""}. Indicative only: a formal ISO/IEC 15416 grade needs a calibrated verifier.`,
      severity: low ? "major" : "info",
      confidence: 1,
      ...(c.box ? { box: c.box } : {}),
    };
  };

  if (r.kind === "image") {
    if (!r.quality.usable) {
      findings.push({
        timestampSec: null,
        category: "Image not usable for inspection",
        description: `Image is ${r.quality.issues.join(", ")} (sharpness ${r.quality.sharpness}, brightness ${r.quality.brightness}, contrast ${r.quality.contrast}). Retake before judging the part.`,
        severity: "major",
        confidence: 1,
      });
    }
    if (r.comparison) {
      for (const d of r.comparison.defects) {
        findings.push({
          timestampSec: null,
          category: "Deviation from golden reference",
          description: `Region at ${Math.round((d.box.x + d.box.w / 2) * 100)}% across, ${Math.round((d.box.y + d.box.h / 2) * 100)}% down differs from the golden board (${pctText(d.areaPct)} of the image, mean difference ${d.meanDiff}). Check for a missing, extra or misplaced part.`,
          severity: d.areaPct >= 0.5 ? "major" : "minor",
          confidence: 1,
          box: d.box,
        });
      }
    }
    findings.push(...r.codes.map(codeFinding));
    if (!findings.length) {
      findings.push({ timestampSec: null, category: "No defect visible", description: r.comparison ? "No region differs from the golden reference above the threshold." : "Image is usable; no codes found. Add a golden reference image to compare parts.", severity: "info", confidence: 1 });
    }
    const deviations = r.comparison?.defects.length ?? 0;
    const summary = [
      `${r.width}×${r.height} image`,
      r.quality.usable ? "usable for inspection" : `not usable (${r.quality.issues.join(", ")})`,
      r.comparison ? `${deviations} region${deviations === 1 ? " differs" : "s differ"} from the golden reference (${r.comparison.alignment === "homography" ? `aligned with ${r.comparison.inliers} feature matches` : "not aligned; compared after resizing"})` : "no golden reference supplied",
      `${r.codes.length} code${r.codes.length === 1 ? "" : "s"} read`,
    ].join(" · ");
    return { summary: `${summary}. ${r.engine}, deterministic.`, findings };
  }

  for (const s of r.stillPeriods) {
    findings.push({
      timestampSec: s.startSec,
      category: "Line motion stopped",
      description: `No motion for ${s.durationSec.toFixed(1)} s (${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)} s). On a fixed camera over a conveyor this usually means the line stopped; confirm against the line's PLC state.`,
      severity: s.durationSec >= 30 ? "major" : "minor",
      confidence: 1,
    });
  }
  const badFrames = r.quality.blurryFrames + r.quality.underexposedFrames + r.quality.overexposedFrames;
  if (badFrames > r.framesAnalysed * 0.2) {
    findings.push({
      timestampSec: null,
      category: "Image not usable for inspection",
      description: `${badFrames} of ${r.framesAnalysed} sampled frames are blurry or badly exposed. Check focus, lighting and lens cleanliness.`,
      severity: "minor",
      confidence: 1,
    });
  }
  findings.push(...r.codes.map(codeFinding));
  if (!findings.length) findings.push({ timestampSec: null, category: "No defect visible", description: "Continuous motion and usable frames throughout the clip.", severity: "info", confidence: 1 });
  return {
    summary: `${r.analysedSec.toFixed(1)} s of video analysed (${r.framesAnalysed} frames at ${r.sampleFps} fps${r.truncated ? ", truncated" : ""}) · moving ${r.movingPct}% of the time · ${r.stillPeriods.length} still period${r.stillPeriods.length === 1 ? "" : "s"} · ${r.codes.length} code${r.codes.length === 1 ? "" : "s"} read. ${r.engine}, deterministic.`,
    findings,
  };
}
