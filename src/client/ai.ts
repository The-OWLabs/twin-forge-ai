"use client";

import { useEffect, useState } from "react";

export interface AiInfo {
  provider: string;
  model: string | null;
  disabled: boolean;
  capabilities: { available: boolean; video: boolean; images: boolean; pdf: boolean; webSearch: boolean };
}

/** The AI provider this server uses and what it can do (from the honest integration status). */
export function useAiInfo(refresh = 0): AiInfo | null {
  const [info, setInfo] = useState<AiInfo | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ai?: AiInfo }) => alive && setInfo(d.ai ?? null))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [refresh]);
  return info;
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
