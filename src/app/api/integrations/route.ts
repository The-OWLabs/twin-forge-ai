import { json, route } from "@/server/http";
import { integrationStatuses, projectSetting } from "@/server/integrations/status";
import { settingsStorage } from "@/server/settings";

export const dynamic = "force-dynamic";

export const GET = route(() => json({ project: projectSetting(), storage: settingsStorage(), integrations: integrationStatuses() }));
