import { json, parseBody, route } from "@/server/http";
import { integrationStatuses, testIntegration } from "@/server/integrations/status";
import { IntegrationTestSchema } from "@/server/schemas";

export const POST = route(async (req: Request) => {
  const { id } = await parseBody(req, IntegrationTestSchema);
  const result = await testIntegration(id);
  return json({ result, integrations: integrationStatuses() });
});
