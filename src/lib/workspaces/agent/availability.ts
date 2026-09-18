import type { Provider } from "./runStore";

export interface ProviderAvailability {
  provider: Provider;
  label: string;
  description: string;
  available: boolean;
  reason?: string;
}

export function getProviderAvailability(): ProviderAvailability[] {
  return [
    {
      provider: "claude-code",
      label: "Claude Code",
      description: "Anthropic's coding agent. Plans, then edits files directly within the workspace.",
      available: Boolean(process.env.ANTHROPIC_API_KEY),
      reason: process.env.ANTHROPIC_API_KEY ? undefined : "ANTHROPIC_API_KEY is not configured.",
    },
    {
      provider: "codex",
      label: "Codex",
      description: "OpenAI's coding agent. Plans, then edits files via sandboxed shell commands within the workspace.",
      available: Boolean(process.env.OPENAI_API_KEY),
      reason: process.env.OPENAI_API_KEY ? undefined : "OPENAI_API_KEY is not configured.",
    },
  ];
}

export function isProviderAvailable(provider: Provider): boolean {
  return getProviderAvailability().find((p) => p.provider === provider)?.available ?? false;
}
