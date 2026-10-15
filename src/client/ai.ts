"use client";

import { useIntegrations, type AiInfo } from "./integrations";

export type { AiInfo };

/** The AI provider this server uses and what it can do (from the honest integration status). */
export function useAiInfo(refresh = 0): AiInfo | null {
  return useIntegrations({ refresh }).data?.ai ?? null;
}

/** Short name for buttons and labels: "Claude", "Gemini", "OpenAI"… */
export function aiShortName(info: AiInfo | null) {
  switch (info?.provider) {
    case "anthropic":
      return "Claude";
    case "openai":
      return "OpenAI";
    case "openai-compatible":
      return "AI";
    case "vertex":
    case "gemini-api":
      return "Gemini";
    default:
      return "AI";
  }
}
