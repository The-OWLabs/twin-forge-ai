import { injectFault } from "@/domain/commands";
import { buildDemoFactory } from "@/domain/seed";
import { advanceFactory } from "@/domain/telemetry";
import { json, nowISO, route } from "@/server/http";
import { replaceState } from "@/server/store";

/**
 * Scripted, reproducible crisis: reset the demo factory, inject joint-4 bearing damage on
 * A-ROB-03 and let the plant model run for 30 simulated minutes so the step change is
 * visible in telemetry. Identical inputs ⇒ identical state on every run.
 */
export const POST = route(() => {
  const state = buildDemoFactory();
  const at = nowISO();
  injectFault(state, { assetId: "A-ROB-03", mode: "bearing-wear", severity: 50 }, at);
  advanceFactory(state, 0.5, { nowISO: at });
  state.clock.lastTickAt = Date.now();
  return json(replaceState(state));
});
