import { json, route } from "@/server/http";
import { integrationStatuses, projectSetting } from "@/server/integrations/status";
import { ensureFreshSettings, settingsStorage } from "@/server/settings";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await ensureFreshSettings();
  return json({ project: projectSetting(), storage: settingsStorage(), integrations: integrationStatuses() });
});
