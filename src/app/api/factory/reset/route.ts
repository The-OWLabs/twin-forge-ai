import { buildDemoFactory } from "@/domain/seed";
import { json, route } from "@/server/http";
import { replaceState } from "@/server/store";

export const POST = route(() => json(replaceState(buildDemoFactory())));
