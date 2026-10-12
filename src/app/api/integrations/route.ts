import { json, route } from "@/server/http";
import { integrationStatuses } from "@/server/integrations/status";

export const dynamic = "force-dynamic";

export const GET = route(() => json({ integrations: integrationStatuses() }));
